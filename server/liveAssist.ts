import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  LIVE_ASSIST_ACTIONS,
  MAX_LIVE_ASSIST_QUESTION_CHARS,
  MAX_LIVE_ASSIST_WINDOW_CHARS,
  MIN_LIVE_ASSIST_WINDOW_CHARS,
  keepTail,
  type LiveAssistAction,
} from "@shared/liveAssist";
import { invokeLLM, type Message } from "./_core/llm";
import { checkTrpcRateLimit } from "./_core/rateLimit";

/**
 * Study help during a live recording (A2). Each call sends only the last few
 * minutes of live text and asks for a short answer, so it finishes in seconds,
 * far inside the 60s function limit (a 25s cap guards the worst case).
 */
export const LIVE_ASSIST_TIMEOUT_MS = 25_000;
export const LIVE_ASSIST_MAX_TOKENS = 450;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 20;

export const liveAssistInputSchema = z.object({
  action: z.enum(LIVE_ASSIST_ACTIONS),
  // The client trims to the window; the server trims again in case it didn't.
  transcriptWindow: z.string().max(MAX_LIVE_ASSIST_WINDOW_CHARS * 2),
  /** The question for "custom", or the term to explain for "explain". */
  question: z.string().trim().max(MAX_LIVE_ASSIST_QUESTION_CHARS).optional(),
  audience: z.enum(["student", "professional"]).optional(),
  windowSeconds: z.number().int().min(10).max(3600).optional(),
});
export type LiveAssistInput = z.infer<typeof liveAssistInputSchema>;

const SYSTEM_PROMPT = [
  "You are StudyScribe's study helper. A student is listening to a lecture or meeting right now and asks for quick help.",
  "You get the most recent part of an automatic live transcript. It can contain recognition mistakes; read past obvious ones.",
  "Answer only from the excerpt and well-established general knowledge needed to explain it. If the excerpt does not cover what is asked, say so in one sentence.",
  "Be brief: the student is still listening. Use at most about 120 words, short Markdown bullets where they help, no headings, no preamble.",
  "Help the student learn and take part. Never write answers for them to pass off in a test, quiz or graded assignment.",
].join(" ");

function describeWindow(windowSeconds: number | undefined) {
  if (!windowSeconds) return "the last few minutes";
  const minutes = Math.round(windowSeconds / 60);
  return minutes <= 1 ? "the last minute" : `the last ${minutes} minutes`;
}

export function buildLiveAssistInstruction(action: LiveAssistAction, question: string | undefined, audience: "student" | "professional" = "student"): string {
  const listener = audience === "professional" ? "someone in a meeting" : "a student";
  switch (action) {
    case "explain":
      return question
        ? `Explain "${question}" as it is used in the excerpt, in plain words for ${listener}, with one short example.`
        : `Pick the most important or hardest term or idea in the latest part of the excerpt. Name it in bold, then explain it in plain words for ${listener}, with one short example.`;
    case "recap":
      return "Recap what was said in 3 to 5 short bullets, in the order it was said.";
    case "examFocus":
      return audience === "professional"
        ? "List up to 5 points from the excerpt most worth remembering or following up on, each with a few words on why."
        : "List up to 5 points from the excerpt most likely to come up in an exam or assignment, each with a few words on why.";
    case "questions":
      return audience === "professional"
        ? "Suggest 3 clear, useful questions to ask in this meeting about what was just discussed."
        : "Suggest 3 clear, thoughtful questions the student could ask the lecturer about this part, ones that deepen understanding rather than repeat what was said.";
    case "custom":
      return `Answer this question about the excerpt: ${question ?? ""}`.trim();
  }
}

export function buildLiveAssistMessages(input: LiveAssistInput): Message[] {
  const excerpt = keepTail(input.transcriptWindow, MAX_LIVE_ASSIST_WINDOW_CHARS);
  const instruction = buildLiveAssistInstruction(input.action, input.question || undefined, input.audience);
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Live transcript, ${describeWindow(input.windowSeconds)}:\n"""\n${excerpt}\n"""\n\n${instruction}`,
    },
  ];
}

/** Validates the request beyond the schema; returns the reason it can't be answered, or null. */
export function liveAssistProblem(input: LiveAssistInput): string | null {
  if ((input.action === "custom") && !input.question?.trim()) return "Type a question first.";
  if (keepTail(input.transcriptWindow, MAX_LIVE_ASSIST_WINDOW_CHARS).length < MIN_LIVE_ASSIST_WINDOW_CHARS) {
    return "There isn't enough live transcript yet. Give it a little longer.";
  }
  return null;
}

export async function runLiveAssist(userId: number, input: LiveAssistInput): Promise<{ answer: string }> {
  const problem = liveAssistProblem(input);
  if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
  if (!checkTrpcRateLimit(`live-assist:${userId}`, RATE_WINDOW_MS, RATE_LIMIT)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "That is a lot of study help in a short time. Try again in a few minutes." });
  }
  try {
    const response = await invokeLLM({
      messages: buildLiveAssistMessages(input),
      max_tokens: LIVE_ASSIST_MAX_TOKENS,
      timeoutMs: LIVE_ASSIST_TIMEOUT_MS,
    });
    const content = response.choices?.[0]?.message?.content;
    const answer = typeof content === "string" ? content.trim() : "";
    if (!answer) throw new Error("empty response");
    return { answer };
  } catch (error) {
    console.error("[ai] live assist failed:", error instanceof Error ? error.message : error);
    const message = error instanceof Error && /not configured/i.test(error.message)
      ? "AI features are not set up on this server yet."
      : error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`)
        ? "Study help took too long. Try again."
        : "Study help isn't available right now. Try again in a moment.";
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
  }
}

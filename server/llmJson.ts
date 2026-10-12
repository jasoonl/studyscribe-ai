import { TRPCError } from "@trpc/server";
import { invokeLLM, type InvokeParams } from "./_core/llm";
import { parseJsonContent } from "./studyExtraction";

/**
 * One model call that must come back as JSON. Failures become explanatory
 * tRPC errors rather than "Unexpected token" parse errors.
 */
export async function completeJson(params: {
  messages: InvokeParams["messages"];
  responseFormat: InvokeParams["response_format"];
  maxTokens: number;
  what: string;
}): Promise<unknown> {
  let content: unknown;
  try {
    const response = await invokeLLM({ messages: params.messages, response_format: params.responseFormat, max_tokens: params.maxTokens });
    content = response.choices?.[0]?.message?.content;
  } catch (error) {
    console.error(`[ai] ${params.what} failed:`, error instanceof Error ? error.message : error);
    const message = error instanceof Error && /not configured/i.test(error.message)
      ? "AI features are not set up on this server yet."
      : `Could not create ${params.what} right now. Try again in a moment.`;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
  }
  const parsed = parseJsonContent(content);
  if (parsed === null) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `The assistant's ${params.what} came back unreadable. Try again.` });
  }
  return parsed;
}

/** Same, for plain Markdown output. */
export async function completeText(params: { messages: InvokeParams["messages"]; maxTokens: number; what: string }): Promise<string> {
  try {
    const response = await invokeLLM({ messages: params.messages, max_tokens: params.maxTokens });
    const content = response.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) throw new Error("empty response");
    return text;
  } catch (error) {
    console.error(`[ai] ${params.what} failed:`, error instanceof Error ? error.message : error);
    const message = error instanceof Error && /not configured/i.test(error.message)
      ? "AI features are not set up on this server yet."
      : `Could not create ${params.what} right now. Try again in a moment.`;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
  }
}

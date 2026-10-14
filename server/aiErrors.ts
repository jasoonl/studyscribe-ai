// One way to explain AI failures (Phase 7, carried over from Phase 6). Every AI procedure
// used to turn provider errors into its own text, and some passed the provider's raw
// response (status codes, JSON) to the person. aiProcedure now runs failures through
// describeAiFailure, which recognises provider trouble anywhere in the error's cause chain.

export type AiFailure = { code: "SERVICE_UNAVAILABLE" | "TOO_MANY_REQUESTS" | "TIMEOUT"; message: string };

function messages(error: unknown): string[] {
  const out: string[] = [];
  for (let current: any = error, depth = 0; current && depth < 5; current = current.cause, depth++) {
    if (typeof current.message === "string") out.push(current.message);
    if (typeof current.name === "string") out.push(current.name);
  }
  return out;
}

/** A clear message for an AI provider problem, or null when the error is something else (keep its own message). */
export function describeAiFailure(error: unknown): AiFailure | null {
  const text = messages(error).join("\n");
  if (/AI is not configured/i.test(text)) {
    return { code: "SERVICE_UNAVAILABLE", message: "AI features are not set up on this server yet. The site owner needs to add an AI key." };
  }
  const status = Number(/LLM invoke failed: (\d{3})/.exec(text)?.[1] ?? 0);
  if (status === 429) {
    return { code: "TOO_MANY_REQUESTS", message: "The AI service is busy right now. Try again in a minute." };
  }
  if (status === 401 || status === 403) {
    return { code: "SERVICE_UNAVAILABLE", message: "The AI service turned this server's key down. The site owner needs to check the AI settings." };
  }
  if (/TimeoutError|timed? ?out|aborted/i.test(text)) {
    return { code: "TIMEOUT", message: "The AI service took too long to answer. Try again in a moment." };
  }
  if (status >= 500 || /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(text)) {
    return { code: "SERVICE_UNAVAILABLE", message: "The AI service is having trouble right now. Try again in a few minutes." };
  }
  if (status === 400 || status === 413) {
    return { code: "SERVICE_UNAVAILABLE", message: "The AI service could not take this request. If it keeps happening, the recording may be too long for it." };
  }
  return null;
}

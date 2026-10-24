import { TRPCClientError } from "@trpc/client";
import { SourceFailedError, SourceStillReadingError, describeError, isRetryableError, rowErrorText } from "./errors";

function trpcError(message: string, data: Record<string, unknown> = {}) {
  return Object.assign(new TRPCClientError(message), { data });
}

describe("describeError", () => {
  it("recognises the usage limit and words it without any plan or link", () => {
    const error = describeError(trpcError("You have used this month's AI allowance", { code: "FORBIDDEN", usageLimit: { kind: "ai_generation", upgradeAvailable: true } }));
    expect(error).toEqual({ kind: "usageLimit" });
    const text = rowErrorText(error);
    expect(text).toBe("You have reached this month's allowance. It resets on the first of the month.");
    expect(text).not.toMatch(/plan|upgrade|price|billing/i);
  });
  it("maps 429 to a plain sentence that stays resumable", () => {
    const error = describeError(trpcError("That is a lot of uploads in a short time. Give it a few minutes.", { code: "TOO_MANY_REQUESTS" }));
    expect(error).toEqual({ kind: "rateLimited" });
    expect(rowErrorText(error)).toBe("You are going a little fast. Try again in a minute.");
    expect(isRetryableError(error)).toBe(true);
  });
  it("maps the server's failed sentences to reasons, never raw text", () => {
    const error = describeError(new SourceFailedError("This PDF is password protected. Remove the password and upload it again.", "pdf"));
    expect(error).toEqual({ kind: "reason", code: "password" });
    expect(isRetryableError(error)).toBe(false);
    expect(describeError(new SourceFailedError("No text could be found in this file.", "docx"))).toEqual({ kind: "reason", code: "noText" });
    expect(describeError(new SourceFailedError("No text could be found in this file.", "pdf"))).toEqual({ kind: "reason", code: "needsOcr" });
  });
  it("shows the server's cap sentences as written", () => {
    const error = describeError(trpcError("A course can hold up to 25 study sources.", { code: "BAD_REQUEST" }));
    expect(error).toEqual({ kind: "message", text: "A course can hold up to 25 study sources." });
    expect(rowErrorText(error)).toBe("A course can hold up to 25 study sources.");
  });
  it("handles not set up, still reading and network errors", () => {
    expect(describeError(trpcError("File storage is not set up on this server yet.", { code: "PRECONDITION_FAILED" }))).toEqual({ kind: "notSetUp" });
    expect(describeError(new SourceStillReadingError())).toEqual({ kind: "stillReading" });
    expect(describeError(trpcError("Network request failed"))).toEqual({ kind: "offline" });
    expect(describeError(new Error("The connection dropped during the upload"))).toEqual({ kind: "offline" });
    expect(rowErrorText({ kind: "offline" })).toBe("Can't reach StudyScribe. Check your connection, then retry.");
  });
  it("falls back to an unexplained failure that can be tried again", () => {
    const error = describeError(new Error("something odd"));
    expect(error).toEqual({ kind: "reason", code: "failed" });
    expect(isRetryableError(error)).toBe(true);
  });
  it("words file problems found before upload", () => {
    expect(rowErrorText({ kind: "file", code: "legacyType" })).toBe("Old .doc and .ppt files are not supported. Save it as .docx or .pptx first.");
    expect(isRetryableError({ kind: "file", code: "tooLarge" })).toBe(false);
  });
});

describe("server cap sentences", () => {
  it.each([
    ["You have reached the storage limit for study sources. Delete one you no longer need first."],
    ["You can keep up to 60 study sources. Delete one you no longer need first."],
    ["A course can hold up to 25 study sources."],
    ["Storage is nearly full, so uploads are paused. Your existing material is safe."],
  ])("shows %s as written, not as the monthly allowance", (sentence) => {
    const error = describeError(trpcError(sentence, { code: "BAD_REQUEST" }));
    expect(error).toEqual({ kind: "message", text: sentence });
    expect(rowErrorText(error)).toBe(sentence);
    expect(rowErrorText(error)).not.toMatch(/resets on the first/);
  });
  it("a paused row has a neutral retryable sentence", () => {
    expect(rowErrorText({ kind: "paused" })).toBe("Paused. Tap Retry to continue.");
    expect(isRetryableError({ kind: "paused" })).toBe(true);
  });
});

describe("generic extraction failure", () => {
  it("is retryable, not 'damaged'", () => {
    const sentence = "We could not read this file. It may be damaged. Try uploading it again.";
    expect(describeError(new SourceFailedError(sentence, "pdf"))).toEqual({ kind: "reason", code: "failed" });
    expect(isRetryableError({ kind: "reason", code: "failed" })).toBe(true);
  });
});

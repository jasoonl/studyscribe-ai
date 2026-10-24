import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { SourceFailedError, SourceStillReadingError, describeError } from "./SourceUploadsContext";

const trpcError = (message: string, code: string, extra: Record<string, unknown> = {}) =>
  TRPCClientError.from({ error: { message, code: -32600, data: { code, ...extra } } } as never);

describe("describeError", () => {
  it("keeps a refused request (429) resumable instead of calling it a failure", () => {
    expect(describeError(trpcError("That is a lot of uploads in a short time. Give it a few minutes.", "TOO_MANY_REQUESTS"))).toEqual({ kind: "rateLimited" });
  });

  it("recognises a plan limit", () => {
    expect(describeError(trpcError("Limit", "FORBIDDEN", { usageLimit: { kind: "ai_generation", upgradeAvailable: true } }))).toEqual({ kind: "usageLimit" });
  });

  it("maps the sentence the server wrote when extraction failed, using the file kind", () => {
    expect(describeError(new SourceFailedError("No text could be found in this file.", "docx"))).toEqual({ kind: "reason", code: "noText" });
    expect(describeError(new SourceFailedError("No text could be found in this file.", "pdf"))).toEqual({ kind: "reason", code: "needsOcr" });
    expect(describeError(new SourceFailedError("This PDF is password protected. Remove the password and upload it again.", "pdf"))).toEqual({ kind: "reason", code: "password" });
  });

  it("explains a source that is still being read", () => {
    expect(describeError(new SourceStillReadingError())).toEqual({ kind: "stillReading" });
  });

  it("shows plain cap sentences and hides anything else", () => {
    expect(describeError(trpcError("You can keep up to 60 study sources. Delete one you no longer need first.", "BAD_REQUEST"))).toEqual({
      kind: "message",
      text: "You can keep up to 60 study sources. Delete one you no longer need first.",
    });
    expect(describeError(new Error("socket hang up"))).toEqual({ kind: "reason", code: "failed" });
    expect(describeError(trpcError("Study sources are not set up on this server yet.", "PRECONDITION_FAILED"))).toEqual({ kind: "notSetUp" });
  });
});

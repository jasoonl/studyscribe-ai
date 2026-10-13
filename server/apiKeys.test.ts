import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { apiKeyMatches, generateApiKey, hashApiKey, looksLikeApiKey, readBearerKey, scopeAllows } from "./apiKeys";
import { KeyRateLimiter, publicRecording, toApiError } from "./publicApi";
import { UsageLimitError } from "./usageRules";
import { appRouter } from "./routers";

describe("API key generation and hashing", () => {
  it("makes a long random key and stores only its SHA-256 hash", () => {
    const first = generateApiKey();
    const second = generateApiKey();
    expect(first.key).toMatch(/^ssk_[A-Za-z0-9_-]{43}$/);
    expect(first.key).not.toBe(second.key);
    expect(first.hash).toBe(hashApiKey(first.key));
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).not.toContain(first.key.slice(4, 20));
    expect(first.prefix).toBe(first.key.slice(0, 12));
  });

  it("matches only the exact key", () => {
    const { key, hash } = generateApiKey();
    expect(apiKeyMatches(key, hash)).toBe(true);
    expect(apiKeyMatches(`${key.slice(0, -1)}x`, hash)).toBe(false);
  });

  it("refuses malformed keys before any lookup", () => {
    expect(looksLikeApiKey(generateApiKey().key)).toBe(true);
    expect(looksLikeApiKey("ssk_short")).toBe(false);
    expect(looksLikeApiKey("sk_live_" + "a".repeat(43))).toBe(false);
  });

  it("reads Bearer tokens", () => {
    expect(readBearerKey("Bearer ssk_abc")).toBe("ssk_abc");
    expect(readBearerKey("bearer   ssk_abc ")).toBe("ssk_abc");
    expect(readBearerKey("Basic abc")).toBeNull();
    expect(readBearerKey(undefined)).toBeNull();
  });
});

describe("scopes", () => {
  it("lets write keys read, and read keys only read", () => {
    expect(scopeAllows("read", "read")).toBe(true);
    expect(scopeAllows("read", "write")).toBe(false);
    expect(scopeAllows("write", "read")).toBe(true);
    expect(scopeAllows("write", "write")).toBe(true);
  });

  it("never lets a key manage keys, billing or delete the account", async () => {
    const user = { id: 1, email: "a@example.com", role: "user", passwordHash: null } as any;
    const api = appRouter.createCaller({ req: { headers: {} } as any, res: {} as any, user, apiKey: { id: 9, scope: "write" } });
    await expect(api.apiKeys.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.apiKeys.create({ name: "x", scope: "write" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.apiKeys.revoke({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.account.deleteAccount({ confirmEmail: "a@example.com" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.account.exportData()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.billing.checkout({ plan: "pro" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.billing.portal({ intent: "cancel" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("per-key rate limits", () => {
  it("allows the limit in a window, then refuses until it resets", () => {
    const limiter = new KeyRateLimiter(60_000);
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(limiter.check("k1", 3, now).allowed).toBe(true);
    const refused = limiter.check("k1", 3, now + 1000);
    expect(refused).toMatchObject({ allowed: false, remaining: 0, resetSeconds: 59 });
    // Another key has its own window.
    expect(limiter.check("k2", 3, now + 1000).allowed).toBe(true);
    expect(limiter.check("k1", 3, now + 60_000).allowed).toBe(true);
  });
});

describe("API errors", () => {
  it("maps procedure errors to HTTP statuses and stable codes", () => {
    expect(toApiError(new TRPCError({ code: "NOT_FOUND", message: "nope" }))).toMatchObject({ status: 404, code: "not_found" });
    expect(toApiError(new TRPCError({ code: "FORBIDDEN", message: "Used up", cause: new UsageLimitError("Used up", "transcription", true) }))).toMatchObject({ status: 402, code: "usage_limit" });
    expect(toApiError(new TRPCError({ code: "TOO_MANY_REQUESTS", message: "slow" }))).toMatchObject({ status: 429, code: "rate_limited" });
    // Internal details never leak.
    expect(toApiError(new Error("SELECT * failed"))).toMatchObject({ status: 500, message: "Something went wrong on our side." });
    const wrapped = (cause: Error) => new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: cause.message, cause });
    expect(toApiError(wrapped(new Error("Failed query: select * from users")))).toMatchObject({ status: 500, code: "server_error" });
    expect(toApiError(wrapped(new TypeError("x is not a function")))).toMatchObject({ status: 500 });
    // Sentences written for people pass through, as they do in the app.
    expect(toApiError(wrapped(new Error("That link points to a private address.")))).toMatchObject({ status: 422, code: "request_failed", message: "That link points to a private address." });
  });

  it("returns recordings without storage keys or provider ids", () => {
    const shape = publicRecording({ id: 1, title: "T", description: null, status: "completed", duration: 0, audience: "student", createdAt: new Date(0), updatedAt: new Date(0), audioKey: "secret", transcriptionProviderId: "p" } as any);
    expect(shape).not.toHaveProperty("audioKey");
    expect(shape).not.toHaveProperty("transcriptionProviderId");
    expect(shape.durationSeconds).toBeNull();
  });
});

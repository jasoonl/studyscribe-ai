import { afterEach, describe, expect, it, vi } from "vitest";
import { isCrossSiteRequest, rejectCrossSitePosts } from "./_core/csrf";
import { getSafeApplicationOrigin } from "./email";
import { publicUser, redactUrlForLog } from "./routers";

const req = (headers: Record<string, string>, method = "POST") => ({ method, headers }) as any;

describe("login CSRF guard", () => {
  it("refuses POSTs another site started", () => {
    expect(isCrossSiteRequest(req({ "sec-fetch-site": "cross-site" }), "app.example")).toBe(true);
    expect(isCrossSiteRequest(req({ origin: "https://evil.example" }), "app.example")).toBe(true);
    expect(isCrossSiteRequest(req({ origin: "null" }), "app.example")).toBe(true);
  });

  it("lets the site itself and non-browser clients through", () => {
    expect(isCrossSiteRequest(req({ "sec-fetch-site": "same-origin" }), "app.example")).toBe(false);
    expect(isCrossSiteRequest(req({ origin: "https://app.example" }), "app.example")).toBe(false);
    expect(isCrossSiteRequest(req({}), "app.example")).toBe(false);
  });

  it("answers 403 as middleware and ignores GET", () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();
    rejectCrossSitePosts(req({ "sec-fetch-site": "cross-site", host: "app.example" }), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    rejectCrossSitePosts(req({ "sec-fetch-site": "cross-site" }, "GET"), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("redirect origins", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("never sends production redirects to localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_APP_URL", "https://studyscribe.example");
    expect(getSafeApplicationOrigin("http://localhost:4000")).not.toBe("http://localhost:4000");
    vi.stubEnv("NODE_ENV", "development");
    expect(getSafeApplicationOrigin("http://localhost:4000")).toBe("http://localhost:4000");
  });
});

describe("auth.me", () => {
  it("never returns the password hash or provider ids", () => {
    const row = { id: 1, email: "a@b.c", name: "A", role: "user", loginMethod: "email", emailVerified: 1, createdAt: new Date(0), lastSignedIn: new Date(0), passwordHash: "$2b$secret", googleId: "g-1", openId: "o-1" };
    const shaped = publicUser(row) as Record<string, unknown>;
    expect(shaped).not.toHaveProperty("passwordHash");
    expect(shaped).not.toHaveProperty("googleId");
    expect(shaped).not.toHaveProperty("openId");
    expect(shaped.emailVerified).toBe(true);
    expect(publicUser(null)).toBeNull();
  });
});

describe("log redaction", () => {
  it("drops query strings, which can carry signed tokens", () => {
    expect(redactUrlForLog("https://s3.example/a.mp3?X-Amz-Signature=abc")).toBe("https://s3.example/a.mp3?…");
    expect(redactUrlForLog("https://example.com/talk.mp3")).toBe("https://example.com/talk.mp3");
  });
});

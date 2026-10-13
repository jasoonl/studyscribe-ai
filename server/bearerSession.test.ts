import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, getBearerToken, getSessionFromRequest, setSessionCookie } from "./sessionManager";
import { mobileTokenResponder, registerMobileRoutes } from "./mobileAuth";
import { createApp } from "./_core/app";

const session = { userId: 7, email: "ada@example.com", role: "user" as const };

describe("getSessionFromRequest", () => {
  it("reads a bearer token", () => {
    const token = createSessionToken(session);
    expect(getBearerToken({ headers: { authorization: `Bearer ${token}` } })).toBe(token);
    expect(getSessionFromRequest({ headers: { authorization: `Bearer ${token}` } })?.userId).toBe(7);
  });

  it("falls back to the session cookie when there is no bearer token", () => {
    const token = createSessionToken(session);
    expect(getSessionFromRequest({ headers: { cookie: `other=1; studyscribe_session=${token}` } })?.email).toBe("ada@example.com");
  });

  it("prefers the bearer token over the cookie", () => {
    const bearer = createSessionToken({ ...session, userId: 8 });
    const cookie = createSessionToken(session);
    expect(getSessionFromRequest({ headers: { authorization: `Bearer ${bearer}`, cookie: `studyscribe_session=${cookie}` } })?.userId).toBe(8);
  });

  it("does not fall back to the cookie when the bearer token is invalid", () => {
    const cookie = createSessionToken(session);
    expect(getSessionFromRequest({ headers: { authorization: "Bearer not-a-token", cookie: `studyscribe_session=${cookie}` } })).toBeNull();
  });

  it("ignores other authorization schemes and empty requests", () => {
    expect(getBearerToken({ headers: { authorization: "Basic abc" } })).toBeNull();
    expect(getSessionFromRequest(undefined)).toBeNull();
    expect(getSessionFromRequest({ headers: {} })).toBeNull();
  });
});

let server: Server | undefined;
async function listen(app: express.Express) {
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

/** A stand-in for /api/auth/login: sets the cookie and answers like the real handler. */
function fakeLoginApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth/login", mobileTokenResponder);
  app.post("/api/auth/login", (req, res) => {
    if (req.body?.password !== "right") {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    setSessionCookie(res, createSessionToken(session));
    res.json({ success: true, user: { id: 7 } });
  });
  return app;
}

describe("mobileTokenResponder", () => {
  it("adds the session token to a successful login for the app", async () => {
    const base = await listen(fakeLoginApp());
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client": "mobile" },
      body: JSON.stringify({ password: "right" }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.user).toEqual({ id: 7 });
    expect(getSessionFromRequest({ headers: { authorization: `Bearer ${body.token}` } })?.userId).toBe(7);
    // The cookie is still set, as for the web.
    expect(response.headers.get("set-cookie")).toContain("studyscribe_session=");
  });

  it("leaves web responses unchanged", async () => {
    const base = await listen(fakeLoginApp());
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "right" }),
    });
    expect(await response.json()).toEqual({ success: true, user: { id: 7 } });
  });

  it("never adds a token to a failed login", async () => {
    const base = await listen(fakeLoginApp());
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client": "mobile" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid email or password" });
  });
});

describe("mobile routes", () => {
  it("refuses a refresh without a valid bearer token", async () => {
    const app = express();
    app.use(express.json());
    registerMobileRoutes(app);
    const base = await listen(app);
    const missing = await fetch(`${base}/api/auth/token/refresh`, { method: "POST" });
    expect(missing.status).toBe(401);
    const forged = await fetch(`${base}/api/auth/token/refresh`, { method: "POST", headers: { Authorization: "Bearer abc.def.ghi" } });
    expect(forged.status).toBe(401);
  });

  it("answers logout even without a session, so the app can always sign out", async () => {
    const base = await listen(createApp());
    const response = await fetch(`${base}/api/auth/token/logout`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it("serves the mobile config without a session", async () => {
    const base = await listen(createApp());
    const response = await fetch(`${base}/api/mobile/config`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("minVersion");
    expect(Object.keys(body.storeUrls).sort()).toEqual(["android", "ios"]);
  });

  it("refuses a playback link that was not signed here", async () => {
    const base = await listen(createApp());
    const response = await fetch(`${base}/api/storage/playback/forged.token/audio.m4a`);
    expect(response.status).toBe(403);
  });

  it("validates the native sign-in bodies before verifying anything", async () => {
    const base = await listen(createApp());
    const google = await fetch(`${base}/api/auth/google/native`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(google.status).toBe(400);
    const apple = await fetch(`${base}/api/auth/apple/native`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(apple.status).toBe(400);
  });
});

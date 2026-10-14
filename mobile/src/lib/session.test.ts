import { AuthError, createAuthClient, tokenExpiry, tokenState, REFRESH_WHEN_LEFT_SECONDS } from "./authApi";
import { createSessionController } from "./session";
import { memoryTokenStore } from "./tokenStore";

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (expSecondsFromNow: number) => `${b64({ alg: "HS256" })}.${b64({ userId: 7, email: "ada@example.com", role: "user", exp: Math.floor(NOW / 1000) + expSecondsFromNow })}.sig`;
const user = { id: 7, email: "ada@example.com", name: "Ada", role: "user" as const };

function fakeFetch(routes: Record<string, (init: RequestInit) => { status: number; body: unknown }>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) throw new TypeError("Network request failed");
    const { status, body } = route(init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { impl, calls };
}

describe("token helpers", () => {
  it("reads a JWT's expiry", () => {
    expect(tokenExpiry(jwt(60))).toBe(Math.floor(NOW / 1000) + 60);
    expect(tokenExpiry("garbage")).toBeNull();
  });

  it("classifies tokens as missing, expired, due for refresh or fresh", () => {
    expect(tokenState(null, NOW)).toBe("missing");
    expect(tokenState(jwt(-5), NOW)).toBe("expired");
    expect(tokenState("not-a-jwt", NOW)).toBe("expired");
    expect(tokenState(jwt(REFRESH_WHEN_LEFT_SECONDS - 10), NOW)).toBe("refresh");
    expect(tokenState(jwt(29 * 24 * 3600), NOW)).toBe("fresh");
  });
});

describe("auth client", () => {
  it("logs in as the mobile client and returns the token", async () => {
    const token = jwt(30 * 24 * 3600);
    const { impl, calls } = fakeFetch({ "/api/auth/login": () => ({ status: 200, body: { success: true, token, user } }) });
    const client = createAuthClient("https://api.test", impl);
    await expect(client.login(" ada@example.com ", "pw")).resolves.toEqual({ success: true, token, user });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-client"]).toBe("mobile");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: "ada@example.com", password: "pw" });
  });

  it("surfaces the server's error message and status", async () => {
    const { impl } = fakeFetch({ "/api/auth/login": () => ({ status: 401, body: { error: "Invalid email or password" } }) });
    const client = createAuthClient("https://api.test", impl);
    await expect(client.login("a@b.co", "x")).rejects.toMatchObject({ message: "Invalid email or password", status: 401 });
  });

  it("refuses a success without a token (an old server without mobile support)", async () => {
    const { impl } = fakeFetch({ "/api/auth/login": () => ({ status: 200, body: { success: true, user } }) });
    await expect(createAuthClient("https://api.test", impl).login("a@b.co", "x")).rejects.toBeInstanceOf(AuthError);
  });

  it("explains a network failure", async () => {
    const client = createAuthClient("https://api.test", async () => {
      throw new TypeError("Network request failed");
    });
    await expect(client.login("a@b.co", "x")).rejects.toMatchObject({ status: 0 });
  });

  it("sends the bearer token when refreshing", async () => {
    const token = jwt(10);
    const { impl, calls } = fakeFetch({ "/api/auth/token/refresh": () => ({ status: 200, body: { success: true, token: jwt(30 * 24 * 3600), user } }) });
    await createAuthClient("https://api.test", impl).refresh(token);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
  });
});

describe("session controller", () => {
  it("is signed out with no stored token", async () => {
    const controller = createSessionController(memoryTokenStore(), createAuthClient("https://api.test", fakeFetch({}).impl), () => NOW);
    await controller.restore();
    expect(controller.getState()).toEqual({ status: "signedOut", reason: undefined });
  });

  it("forgets an expired token", async () => {
    const store = memoryTokenStore(jwt(-60));
    const controller = createSessionController(store, createAuthClient("https://api.test", fakeFetch({}).impl), () => NOW);
    await controller.restore();
    expect(controller.getState().status).toBe("signedOut");
    expect(await store.get()).toBeNull();
  });

  it("restores a fresh token after checking it with the server", async () => {
    const token = jwt(29 * 24 * 3600);
    const { impl } = fakeFetch({ "/api/auth/me": () => ({ status: 200, body: user }) });
    const controller = createSessionController(memoryTokenStore(token), createAuthClient("https://api.test", impl), () => NOW);
    await controller.restore();
    expect(controller.getState()).toEqual({ status: "signedIn", token, user });
    expect(controller.getToken()).toBe(token);
  });

  it("refreshes an ageing token and stores the new one", async () => {
    const old = jwt(5 * 24 * 3600);
    const fresh = jwt(30 * 24 * 3600);
    const store = memoryTokenStore(old);
    const { impl } = fakeFetch({ "/api/auth/token/refresh": () => ({ status: 200, body: { success: true, token: fresh, user } }) });
    const controller = createSessionController(store, createAuthClient("https://api.test", impl), () => NOW);
    await controller.restore();
    expect(controller.getToken()).toBe(fresh);
    expect(await store.get()).toBe(fresh);
  });

  it("signs out when the server rejects the token", async () => {
    const store = memoryTokenStore(jwt(29 * 24 * 3600));
    const { impl } = fakeFetch({ "/api/auth/me": () => ({ status: 401, body: { error: "Not authenticated" } }) });
    const controller = createSessionController(store, createAuthClient("https://api.test", impl), () => NOW);
    await controller.restore();
    expect(controller.getState().status).toBe("signedOut");
    expect(await store.get()).toBeNull();
  });

  it("stays signed in offline so recording keeps working", async () => {
    const token = jwt(29 * 24 * 3600);
    const controller = createSessionController(memoryTokenStore(token), createAuthClient("https://api.test", fakeFetch({}).impl), () => NOW);
    await controller.restore();
    expect(controller.getState()).toMatchObject({ status: "signedIn", token, user: { id: 7, email: "ada@example.com" } });
  });

  it("stores the token on sign-in, notifies listeners, and clears it on sign-out", async () => {
    const store = memoryTokenStore();
    const token = jwt(30 * 24 * 3600);
    const { impl, calls } = fakeFetch({ "/api/auth/token/logout": () => ({ status: 200, body: { success: true } }) });
    const controller = createSessionController(store, createAuthClient("https://api.test", impl), () => NOW);
    const seen: string[] = [];
    controller.subscribe((state) => seen.push(state.status));
    await controller.signIn({ token, user });
    expect(await store.get()).toBe(token);
    await controller.signOut("ExponentPushToken[abc]");
    expect(await store.get()).toBeNull();
    expect(seen).toEqual(["signedIn", "signedOut"]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ pushToken: "ExponentPushToken[abc]" });
  });

  it("expires the session when the API says so", async () => {
    const store = memoryTokenStore();
    const controller = createSessionController(store, createAuthClient("https://api.test", fakeFetch({}).impl), () => NOW);
    await controller.signIn({ token: jwt(100), user });
    await controller.expire();
    expect(controller.getState()).toMatchObject({ status: "signedOut", reason: "Your session ended. Sign in again." });
  });
});

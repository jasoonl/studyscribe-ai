import { describe, expect, it, vi } from "vitest";
import { EXPO_PUSH_URL, buildExpoMessage, deadTokensFromTickets, isExpoPushToken, sendNativePush, type NativePushDeps } from "./nativePush";

const token = (n: number) => `ExponentPushToken[token-${String(n).padStart(4, "0")}]`;

describe("native push helpers", () => {
  it("recognises Expo push tokens only", () => {
    expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abcdefgh12345]")).toBe(true);
    expect(isExpoPushToken("https://fcm.googleapis.com/abc")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
    expect(isExpoPushToken(42)).toBe(false);
  });

  it("builds a message that carries the web path for the app to open", () => {
    expect(buildExpoMessage(token(1), { title: "Transcription complete", body: "Ready", url: "/recording/12", tag: "recording-12" })).toEqual({
      to: token(1),
      title: "Transcription complete",
      body: "Ready",
      sound: "default",
      priority: "high",
      channelId: "default",
      threadId: "recording-12",
      data: { url: "/recording/12", tag: "recording-12" },
    });
  });

  it("finds tokens Expo reports as no longer registered", () => {
    const tickets = [{ status: "ok" as const, id: "1" }, { status: "error" as const, details: { error: "DeviceNotRegistered" } }, { status: "error" as const, details: { error: "MessageRateExceeded" } }];
    expect(deadTokensFromTickets([token(1), token(2), token(3)], tickets)).toEqual([token(2)]);
  });
});

describe("sendNativePush", () => {
  function fakeDeps(tokens: string[], respond: (messages: { to: string }[]) => unknown, overrides: Partial<NativePushDeps> = {}) {
    const deleteTokens = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(respond(messages)), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    return { deps: { tokensForUser: async () => tokens, deleteTokens, fetch: fetchMock as unknown as typeof fetch, ...overrides }, deleteTokens, fetchMock };
  }

  it("sends nothing when the user has no devices", async () => {
    const { deps, fetchMock } = fakeDeps([], () => ({ data: [] }));
    expect(await sendNativePush(1, { title: "t", body: "b" }, deps)).toEqual({ delivered: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batches by 100, counts deliveries and removes dead tokens", async () => {
    const tokens = Array.from({ length: 150 }, (_, i) => token(i));
    const { deps, deleteTokens, fetchMock } = fakeDeps(tokens, (messages) => ({
      data: messages.map((message) => (message.to === token(120) ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "x" })),
    }), { accessToken: "secret" });
    const result = await sendNativePush(1, { title: "t", body: "b" }, deps);
    expect(result).toEqual({ delivered: 149 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(EXPO_PUSH_URL);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(deleteTokens).toHaveBeenLastCalledWith([token(120)]);
  });

  it("never throws, even when the push service is down", async () => {
    const deps: NativePushDeps = {
      tokensForUser: async () => [token(1)],
      deleteTokens: async () => undefined,
      fetch: (async () => { throw new Error("network down"); }) as unknown as typeof fetch,
    };
    await expect(sendNativePush(1, { title: "t", body: "b" }, deps)).resolves.toEqual({ delivered: 0 });
  });
});

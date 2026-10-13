import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi, decodeTrpcResponse, encodeTrpcInput } from "./api";

const ORIGIN = "https://studyscribe-ai.vercel.app";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** What the server's tRPC adapter sends back, through the same superjson transformer. */
function trpcResult(data: unknown) {
  return { result: { data: superjson.serialize(data) } };
}

describe("tRPC wire format", () => {
  it("encodes input the way the web client's superjson link does", () => {
    expect(JSON.parse(encodeTrpcInput({ url: "https://a.b/", audience: "student" }))).toEqual({ json: { url: "https://a.b/", audience: "student" } });
  });

  it("decodes results, restoring dates", () => {
    const createdAt = new Date("2026-10-12T10:00:00Z");
    const rows = decodeTrpcResponse<Array<{ id: number; createdAt: Date }>>(200, trpcResult([{ id: 1, createdAt }]));
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[0].createdAt.getTime()).toBe(createdAt.getTime());
  });

  it("turns tRPC errors into readable ApiErrors", () => {
    const body = { error: superjson.serialize({ message: "Storage is not configured", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } }) };
    expect(() => decodeTrpcResponse(500, body)).toThrow("Storage is not configured");
    const unauthorized = { error: { json: { message: "Please login (10001)", data: { code: "UNAUTHORIZED", httpStatus: 401 } } } };
    try {
      decodeTrpcResponse(401, unauthorized);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).signedOut).toBe(true);
      expect((error as ApiError).message).toBe("Sign in to StudyScribe to continue.");
    }
  });
});

describe("createApi", () => {
  it("reads the session from the site with credentials", async () => {
    const fetchImpl = vi.fn(async () => json({ id: 1, email: "avery@example.com", name: "Avery", role: "user" }));
    await expect(createApi(ORIGIN, fetchImpl).me()).resolves.toMatchObject({ email: "avery@example.com" });
    expect(fetchImpl).toHaveBeenCalledWith(`${ORIGIN}/api/auth/me`, expect.objectContaining({ credentials: "include" }));
  });

  it("treats 401 from /api/auth/me as signed out, not as an error", async () => {
    await expect(createApi(ORIGIN, async () => json({ error: "Not authenticated" }, 401)).me()).resolves.toBeNull();
  });

  it("explains a network failure", async () => {
    const api = createApi(ORIGIN, async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api.me()).rejects.toThrow(/could not be reached/);
  });

  it("posts createFromUrl with only the fields given", async () => {
    const fetchImpl = vi.fn(async () => json(trpcResult({ id: 12, title: "Lecture" })));
    const api = createApi(ORIGIN, fetchImpl);
    await expect(api.createFromUrl({ url: "https://example.com/lecture" })).resolves.toEqual({ id: 12, title: "Lecture" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/api/trpc/recordings.createFromUrl`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ json: { url: "https://example.com/lecture", audience: "student" } });

    await api.createFromUrl({ url: "https://example.com/l", title: "Week 3", language: "es" });
    expect(JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).json).toEqual({
      url: "https://example.com/l",
      audience: "student",
      title: "Week 3",
      language: "es",
    });
  });

  it("creates a recording from an upload", async () => {
    const fetchImpl = vi.fn(async () => json(trpcResult({ id: 3, title: "Tab" })));
    await createApi(ORIGIN, fetchImpl).createRecording({ title: "Tab", duration: 61, audio: { audioUpload: { key: "1/recordings/x-webm.bin", mimeType: "audio/webm" } } });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.json).toEqual({ title: "Tab", audience: "student", duration: 61, audioUpload: { key: "1/recordings/x-webm.bin", mimeType: "audio/webm" } });
  });

  it("lists the newest recordings first", async () => {
    const rows = [
      { id: 1, title: "Old", status: "completed", duration: 60, createdAt: new Date("2026-10-01") },
      { id: 2, title: "New", status: "processing", duration: 0, createdAt: new Date("2026-10-12") },
      { id: 3, title: "Mid", status: "failed", duration: 30, createdAt: new Date("2026-10-05") },
    ];
    const fetchImpl = vi.fn(async () => json(trpcResult(rows)));
    const recent = await createApi(ORIGIN, fetchImpl).recentRecordings(2);
    expect(recent.map(r => r.title)).toEqual(["New", "Mid"]);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(`${ORIGIN}/api/trpc/recordings.list`);
  });
});

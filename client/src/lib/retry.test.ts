import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry, isRetryableStatus } from "./retry";

const noSleep = async () => {};

describe("fetchWithRetry", () => {
  it("retries network errors and 5xx, then succeeds", async () => {
    const run = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const response = await fetchWithRetry(run, { sleep: noSleep });
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 4xx", async () => {
    const run = vi.fn(async () => new Response("", { status: 403 }));
    expect((await fetchWithRetry(run, { sleep: noSleep })).status).toBe(403);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last attempt with the last answer or error", async () => {
    const failing = vi.fn(async () => new Response("", { status: 500 }));
    expect((await fetchWithRetry(failing, { attempts: 2, sleep: noSleep })).status).toBe(500);
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchWithRetry(offline, { attempts: 2, sleep: noSleep })).rejects.toThrow("Failed to fetch");
  });

  it("knows which statuses are worth retrying", () => {
    expect([429, 500, 502, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 409, 413].some(isRetryableStatus)).toBe(false);
  });
});

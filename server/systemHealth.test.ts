import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: async () => ({ execute: async () => [[{ 1: 1 }]] }),
  getAppSetting: async () => ({ value: new Date(Date.now() - 2 * 3_600_000).toISOString(), updatedAt: new Date() }),
  setAppSetting: async () => undefined,
}));

const { cronStatus, describeFailure, runHealthChecks, statusFromResponse, storageStatus } = await import("./systemHealth");

describe("system health rules", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads provider answers", () => {
    expect(statusFromResponse(200, "X").status).toBe("ok");
    expect(statusFromResponse(401, "X")).toMatchObject({ status: "error", detail: expect.stringContaining("refused the key") });
    expect(statusFromResponse(429, "X").status).toBe("warn");
    expect(statusFromResponse(503, "X").status).toBe("error");
  });

  it("warns as storage fills up", () => {
    const gb = 1024 ** 3;
    expect(storageStatus({ configured: true, totalBytes: 0.5 * gb, limitBytes: gb }).status).toBe("ok");
    expect(storageStatus({ configured: true, totalBytes: 0.85 * gb, limitBytes: gb }).status).toBe("warn");
    expect(storageStatus({ configured: true, totalBytes: 0.97 * gb, limitBytes: gb }).status).toBe("error");
  });

  it("notices a cron that stopped", () => {
    vi.stubEnv("CRON_SECRET", "x");
    const now = new Date("2026-10-14T12:00:00Z");
    expect(cronStatus(new Date("2026-10-14T00:00:00Z"), now).status).toBe("ok");
    expect(cronStatus(new Date("2026-10-12T00:00:00Z"), now).status).toBe("error");
    expect(cronStatus(null, now).status).toBe("warn");
    vi.stubEnv("CRON_SECRET", "");
    expect(cronStatus(null, now).status).toBe("off");
  });

  it("describes failures without echoing their message", () => {
    const leaky = Object.assign(new Error("Invalid API key sk_live_abcdef"), { status: 401 });
    expect(describeFailure(leaky)).toBe("The service answered 401.");
    expect(describeFailure(new Error("secret in message"))).toBe("The check failed.");
  });

  it("never puts a key in the report", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "aai_secret_key_123");
    vi.stubEnv("OPENAI_API_KEY", "sk-secret-openai-456");
    vi.stubEnv("RESEND_API_KEY", "re_secret_789");
    vi.stubEnv("RESEND_FROM_EMAIL", "notes@studyscribe.example");
    const fetcher = vi.fn(async (url: string) => new Response("{\"error\":\"bad key sk-secret-openai-456\"}", { status: String(url).includes("assemblyai") ? 200 : 401 }));
    const checks = await runHealthChecks(fetcher as unknown as typeof fetch);
    const text = JSON.stringify(checks);
    for (const secret of ["aai_secret_key_123", "sk-secret-openai-456", "re_secret_789"]) expect(text).not.toContain(secret);
    expect(checks.find(check => check.id === "assemblyai")?.status).toBe("ok");
    expect(checks.find(check => check.id === "llm")?.status).toBe("error");
    expect(checks.find(check => check.id === "database")?.status).toBe("ok");
    expect(checks.map(check => check.id)).toEqual(["database", "storage", "assemblyai", "llm", "embeddings", "stripe", "resend", "recall", "workos", "push", "cron"]);
  });
});

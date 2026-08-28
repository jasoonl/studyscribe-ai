import { describe, expect, it } from "vitest";

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

describe("production provider credentials", () => {
  it("authenticates with the configured Resend and AssemblyAI accounts without sending data", async () => {
    const resendKey = process.env.RESEND_API_KEY;
    const assemblyKey = process.env.ASSEMBLYAI_API_KEY;

    expect(resendKey, "RESEND_API_KEY must be configured").toBeTruthy();
    expect(assemblyKey, "ASSEMBLYAI_API_KEY must be configured").toBeTruthy();

    const [resendResponse, assemblyResponse] = await Promise.all([
      fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${resendKey}` },
      }),
      fetch("https://api.assemblyai.com/v2/transcript?limit=1", {
        headers: { Authorization: assemblyKey! },
      }),
    ]);

    expect(resendResponse.status, `Resend credential check failed with ${resendResponse.status}`).toBeGreaterThanOrEqual(200);
    expect(resendResponse.status).toBeLessThan(300);
    expect(assemblyResponse.status, `AssemblyAI credential check failed with ${assemblyResponse.status}`).toBeGreaterThanOrEqual(200);
    expect(assemblyResponse.status).toBeLessThan(300);
  }, 20_000);

  it("contains a complete VAPID identity suitable for browser push signing", () => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;

    expect(publicKey, "VAPID_PUBLIC_KEY must be configured").toBeTruthy();
    expect(privateKey, "VAPID_PRIVATE_KEY must be configured").toBeTruthy();
    expect(subject, "VAPID_SUBJECT must be configured").toMatch(/^(mailto:|https:\/\/)/);
    expect(decodeBase64Url(publicKey!).length).toBeGreaterThanOrEqual(64);
    expect(decodeBase64Url(privateKey!).length).toBeGreaterThanOrEqual(32);
  });
});

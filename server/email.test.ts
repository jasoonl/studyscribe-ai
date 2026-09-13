import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPasswordResetEmail, getApplicationOrigin, getSafeApplicationOrigin, isTransactionalEmailConfigured, sendPasswordResetEmail } from "./email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("transactional password-reset email", () => {
  it("uses a known safe application origin and preserves approved preview origins", () => {
    expect(getSafeApplicationOrigin("https://studyscribe-ai.manus.space")).toBe("https://studyscribe-ai.manus.space");
    expect(getSafeApplicationOrigin("https://untrusted.example/reset")).toBe("https://studyscribe-ai.manus.space");
    expect(getSafeApplicationOrigin("https://3000-local-preview.us4.manus.computer")).toBe("https://3000-local-preview.us4.manus.computer");
    expect(getSafeApplicationOrigin("https://studyscribe-ai.vercel.app")).toBe("https://studyscribe-ai.vercel.app");
  });

  it("uses PUBLIC_APP_URL for an external deployment and rejects spoofed origins", () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://app.example.com/ignored-path");
    expect(getApplicationOrigin()).toBe("https://app.example.com");
    expect(getSafeApplicationOrigin("https://app.example.com/login")).toBe("https://app.example.com");
    expect(getSafeApplicationOrigin("https://attacker.example")).toBe("https://app.example.com");
  });

  it("builds an email with a one-time reset call to action and escapes its link", () => {
    const email = buildPasswordResetEmail("https://studyscribe-ai.manus.space/reset-password?token=<unsafe>");
    expect(email.subject).toBe("Reset your StudyScribe password");
    expect(email.html).toContain("This link expires in 30 minutes and can be used only once.");
    expect(email.html).toContain("token=&lt;unsafe&gt;");
  });

  it("sends the reset message through Resend without exposing provider credentials", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-provider-key");
    vi.stubEnv("RESEND_FROM_EMAIL", "StudyScribe AI <support@example.com>");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email_123" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(isTransactionalEmailConfigured()).toBe(true);
    await sendPasswordResetEmail({
      to: "learner@example.com",
      resetUrl: "https://studyscribe-ai.manus.space/reset-password?token=opaque-token",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      from: "StudyScribe AI <support@example.com>",
      to: ["learner@example.com"],
      subject: "Reset your StudyScribe password",
    });
  });

  it("fails closed when the email provider rejects delivery", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-provider-key");
    vi.stubEnv("RESEND_FROM_EMAIL", "StudyScribe AI <support@example.com>");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid", { status: 401 })));

    await expect(sendPasswordResetEmail({
      to: "learner@example.com",
      resetUrl: "https://studyscribe-ai.manus.space/reset-password?token=opaque-token",
    })).rejects.toThrow("Transactional email provider returned 401");
  });
});

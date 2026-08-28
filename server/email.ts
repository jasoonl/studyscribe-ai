const RESEND_ENDPOINT = "https://api.resend.com/emails";

const productionOrigins = new Set([
  "https://studyscribe-ai.manus.space",
  "https://scribesync-asvcfial.manus.space",
]);

export function isTransactionalEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

export function getSafeApplicationOrigin(candidate: string | undefined) {
  if (!candidate) return "https://studyscribe-ai.manus.space";

  try {
    const parsed = new URL(candidate);
    const isPreview = /^https:\/\/3000-[a-z0-9-]+\.us\d+\.manus\.computer$/i.test(parsed.origin);
    const isLocal = /^http:\/\/localhost:\d+$/i.test(parsed.origin);
    if (productionOrigins.has(parsed.origin) || isPreview || isLocal) return parsed.origin;
  } catch {
    // Use the production origin below when an untrusted string cannot be parsed.
  }

  return "https://studyscribe-ai.manus.space";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character];
  });
}

export function buildPasswordResetEmail(resetUrl: string) {
  const safeResetUrl = escapeHtml(resetUrl);
  return {
    subject: "Reset your StudyScribe password",
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#f7f8fc;color:#172033;font-family:Arial,sans-serif;">
    <main style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:36px;box-shadow:0 8px 24px rgba(30,41,59,.08);">
      <p style="margin:0 0 10px;color:#4f46e5;font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">StudyScribe AI</p>
      <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;">Reset your password</h1>
      <p style="margin:0 0 24px;line-height:1.6;">We received a request to reset the password for your StudyScribe account. Use the secure link below to choose a new password.</p>
      <p style="margin:0 0 28px;"><a href="${safeResetUrl}" style="display:inline-block;border-radius:10px;background:#4f46e5;color:#ffffff;padding:13px 18px;text-decoration:none;font-weight:700;">Reset password</a></p>
      <p style="margin:0 0 8px;line-height:1.6;font-size:14px;color:#596579;">This link expires in 30 minutes and can be used only once.</p>
      <p style="margin:0;line-height:1.6;font-size:14px;color:#596579;">If you did not request a password reset, you can safely ignore this message.</p>
    </main>
  </body>
</html>`,
  };
}

export async function sendPasswordResetEmail(input: { to: string; resetUrl: string }) {
  if (!isTransactionalEmailConfigured()) {
    throw new Error("Transactional email is not configured");
  }

  const email = buildPasswordResetEmail(input.resetUrl);
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [input.to],
      subject: email.subject,
      html: email.html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Transactional email provider returned ${response.status}`);
  }
}

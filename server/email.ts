import { CONTACT_EMAIL, OPERATOR_NAME } from "@shared/legal";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const defaultApplicationOrigin = "https://studyscribe-ai.manus.space";
const knownManusOrigins = new Set([
  defaultApplicationOrigin,
  "https://scribesync-asvcfial.manus.space",
]);

const knownVercelOrigins = new Set([
  "https://studyscribe-ai.vercel.app",
]);

function getConfiguredApplicationOrigin() {
  const configured = process.env.PUBLIC_APP_URL || process.env.APP_URL;
  if (!configured) return defaultApplicationOrigin;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.origin;
  } catch {
    // Fall back to the known safe origin when configuration is malformed.
  }
  return defaultApplicationOrigin;
}

export function getApplicationOrigin() {
  return getConfiguredApplicationOrigin();
}

export function isTransactionalEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

export function getSafeApplicationOrigin(candidate: string | undefined) {
  const configuredOrigin = getConfiguredApplicationOrigin();
  if (!candidate) return configuredOrigin;

  try {
    const parsed = new URL(candidate);
    const isPreview = /^https:\/\/3000-[a-z0-9-]+\.us\d+\.manus\.computer$/i.test(parsed.origin);
    const isLocal = /^http:\/\/localhost:\d+$/i.test(parsed.origin);
    if (knownManusOrigins.has(parsed.origin) || knownVercelOrigins.has(parsed.origin) || parsed.origin === configuredOrigin || isPreview || isLocal) return parsed.origin;
  } catch {
    // Use the configured origin below when an untrusted string cannot be parsed.
  }

  return configuredOrigin;
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
      <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e3e7ef;line-height:1.6;font-size:12px;color:#596579;">You received this one-off account email because a password reset was requested for this address. ${OPERATOR_NAME} does not send marketing email. Questions: <a href="mailto:${CONTACT_EMAIL}" style="color:#4f46e5;">${CONTACT_EMAIL}</a></p>
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

/** Resend's endpoint, or a local mock (RESEND_TEST_ENDPOINT) outside production. */
function resendEndpoint() {
  const override = process.env.NODE_ENV !== "production" ? process.env.RESEND_TEST_ENDPOINT?.trim() : undefined;
  return override || RESEND_ENDPOINT;
}

export function buildEmailVerificationEmail(verifyUrl: string) {
  const safeUrl = escapeHtml(verifyUrl);
  return {
    subject: "Confirm your StudyScribe email",
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#f7f8fc;color:#172033;font-family:Arial,sans-serif;">
    <main style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:36px;box-shadow:0 8px 24px rgba(30,41,59,.08);">
      <p style="margin:0 0 10px;color:#4f46e5;font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">StudyScribe AI</p>
      <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;">Confirm your email</h1>
      <p style="margin:0 0 24px;line-height:1.6;">Thanks for creating a StudyScribe account. Confirm this address to start transcribing recordings and using the study tools.</p>
      <p style="margin:0 0 28px;"><a href="${safeUrl}" style="display:inline-block;border-radius:10px;background:#4f46e5;color:#ffffff;padding:13px 18px;text-decoration:none;font-weight:700;">Confirm email</a></p>
      <p style="margin:0 0 8px;line-height:1.6;font-size:14px;color:#596579;">This link expires in 24 hours.</p>
      <p style="margin:0;line-height:1.6;font-size:14px;color:#596579;">If you did not create an account, you can ignore this message and nothing more will be sent.</p>
      <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e3e7ef;line-height:1.6;font-size:12px;color:#596579;">You received this one-off account email because this address was used to sign up. ${OPERATOR_NAME} does not send marketing email. Questions: <a href="mailto:${CONTACT_EMAIL}" style="color:#4f46e5;">${CONTACT_EMAIL}</a></p>
    </main>
  </body>
</html>`,
  };
}

export async function sendEmailVerificationEmail(input: { to: string; verifyUrl: string }) {
  if (!isTransactionalEmailConfigured()) throw new Error("Transactional email is not configured");
  const email = buildEmailVerificationEmail(input.verifyUrl);
  const response = await fetch(resendEndpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [input.to], subject: email.subject, html: email.html }),
  });
  if (!response.ok) throw new Error(`Transactional email provider returned ${response.status}`);
}

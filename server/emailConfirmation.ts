import { TRPCError } from "@trpc/server";
import { isTransactionalEmailConfigured } from "./email";

/** loginMethod of accounts created through open sign-up (F4); nothing else uses it. */
export const OPEN_SIGNUP_LOGIN_METHOD = "email_open";

/** Accounts from open sign-up that have not confirmed their email, on a server that can send the link. */
export function needsEmailConfirmation(user: { loginMethod?: string | null; emailVerified?: number | null }, emailConfigured = isTransactionalEmailConfigured()) {
  return emailConfigured && user.loginMethod === OPEN_SIGNUP_LOGIN_METHOD && !user.emailVerified;
}

export function assertEmailConfirmed(user: { loginMethod?: string | null; emailVerified?: number | null }) {
  if (needsEmailConfirmation(user)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Confirm your email first. We sent you a link when you signed up; you can send it again from the dashboard." });
  }
}

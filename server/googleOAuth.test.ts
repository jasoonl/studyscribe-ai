import { describe, it, expect } from "vitest";
import {
  isGoogleOAuthConfigured,
  getGoogleAuthUrl,
  getGoogleRedirectUri,
} from "./googleOAuthHandler";
import { readOAuthState } from "./googleSignup";

describe("Google OAuth configuration", () => {
  it("should have GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET configured", () => {
    expect(process.env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID must be set").toBeTruthy();
    expect(
      process.env.GOOGLE_CLIENT_SECRET,
      "GOOGLE_CLIENT_SECRET must be set"
    ).toBeTruthy();
    expect(isGoogleOAuthConfigured()).toBe(true);
  });

  it("should produce a Google client id that looks valid", () => {
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    // Google web client IDs end with .apps.googleusercontent.com
    expect(clientId.endsWith(".apps.googleusercontent.com")).toBe(true);
  });

  it("should build a redirect URI matching the callback route", () => {
    const origin = "https://example.manus.space";
    expect(getGoogleRedirectUri(origin)).toBe(
      "https://example.manus.space/api/auth/google/callback"
    );
  });

  it("should generate a valid Google consent URL containing the client id and redirect uri", () => {
    const origin = "https://example.manus.space";
    const redirectUri = getGoogleRedirectUri(origin);
    const url = getGoogleAuthUrl(origin, "login", redirectUri);
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://accounts.google.com");
    expect(parsed.searchParams.get("client_id")).toBe(
      process.env.GOOGLE_CLIENT_ID
    );
    expect(parsed.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(readOAuthState(parsed.searchParams.get("state") ?? "")).toMatchObject({ origin, mode: "login" });
    expect(parsed.searchParams.get("scope")).toContain("email");
    expect(parsed.searchParams.get("response_type")).toBe("code");
  });

  it("records sign-up consent in the OAuth state only when it was given", () => {
    const origin = "https://example.com";
    const stateOf = (url: string) => readOAuthState(new URL(url).searchParams.get("state") ?? "");

    expect(stateOf(getGoogleAuthUrl(origin, "signup", undefined, true, "invite1"))).toMatchObject({ origin, mode: "signup", consented: true, invite: "invite1" });
    expect(stateOf(getGoogleAuthUrl(origin, "signup"))).toMatchObject({ origin, mode: "signup", consented: false });
    // A login never carries an invite.
    expect(stateOf(getGoogleAuthUrl(origin, "login", undefined, false, "invite1"))?.invite).toBeUndefined();
  });
});

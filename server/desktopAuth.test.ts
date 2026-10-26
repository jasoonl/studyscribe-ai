import { describe, expect, it } from "vitest";
import { desktopChallenge, desktopHandoffPage, isDesktopChallenge, readDesktopHandoff, signDesktopHandoff } from "./desktopAuth";
import { readOAuthState, signOAuthState } from "./googleSignup";

const SECRET = "test-secret";
const NOW = 1_800_000_000;
const VERIFIER = "v".repeat(43);

describe("desktop Google sign-in handoff", () => {
  const challenge = desktopChallenge(VERIFIER);

  it("makes a challenge the OAuth state accepts", () => {
    expect(isDesktopChallenge(challenge)).toBe(true);
    const state = signOAuthState({ origin: "https://app.example", mode: "login", desktop: challenge }, SECRET, NOW);
    expect(readOAuthState(state, SECRET, NOW)?.desktop).toBe(challenge);
    const plain = signOAuthState({ origin: "https://app.example", mode: "login" }, SECRET, NOW);
    expect(readOAuthState(plain, SECRET, NOW)?.desktop).toBeUndefined();
  });

  it("gives the account back only with the app's verifier", () => {
    const code = signDesktopHandoff({ userId: 7, challenge, next: "/recording/3" }, SECRET, NOW);
    expect(readDesktopHandoff(code, VERIFIER, SECRET, NOW + 60)).toEqual({ userId: 7, next: "/recording/3" });
    expect(readDesktopHandoff(code, "w".repeat(43), SECRET, NOW + 60)).toBeNull();
    expect(readDesktopHandoff(code, undefined, SECRET, NOW + 60)).toBeNull();
  });

  it("refuses a code that expired, was edited or signed with another secret", () => {
    const code = signDesktopHandoff({ userId: 7, challenge }, SECRET, NOW);
    expect(readDesktopHandoff(code, VERIFIER, SECRET, NOW + 6 * 60)).toBeNull();
    expect(readDesktopHandoff(code, VERIFIER, "other-secret", NOW)).toBeNull();
    const [body, signature] = code.split(".");
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), userId: 1 })).toString("base64url");
    expect(readDesktopHandoff(`${edited}.${signature}`, VERIFIER, SECRET, NOW)).toBeNull();
  });

  it("does not accept a signed OAuth state as a handoff code", () => {
    const state = signOAuthState({ origin: "https://app.example", mode: "login", desktop: challenge }, SECRET, NOW);
    expect(readDesktopHandoff(state, VERIFIER, SECRET, NOW)).toBeNull();
  });

  it("drops a landing path on another site", () => {
    const code = signDesktopHandoff({ userId: 7, challenge, next: "//evil.example" }, SECRET, NOW);
    expect(readDesktopHandoff(code, VERIFIER, SECRET, NOW)).toEqual({ userId: 7, next: undefined });
  });

  it("links back to the app with the code", () => {
    const page = desktopHandoffPage("abc.def");
    expect(page).toContain('href="studyscribe://signed-in?code=abc.def"');
    expect(page).toContain('content="0;url=studyscribe://signed-in?code=abc.def"');
  });
});

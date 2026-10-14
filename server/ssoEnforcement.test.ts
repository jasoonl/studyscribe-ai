import { describe, expect, it } from "vitest";
import { canRequireSso, ssoOnlyKey, ssoRequired } from "./ssoEnforcement";

const team = { verifiedDomain: "uni.edu", workosOrganizationId: "org_123", ownerId: 1 };

describe("SSO-only teams", () => {
  it("can be required only with a verified domain and a linked WorkOS organisation", () => {
    expect(canRequireSso(team)).toBe(true);
    expect(canRequireSso({ ...team, verifiedDomain: null })).toBe(false);
    expect(canRequireSso({ ...team, workosOrganizationId: null })).toBe(false);
  });

  it("refuses other sign-in methods for the domain once required", () => {
    expect(ssoRequired(team, true, "student@uni.edu", 5)).toBe(true);
    expect(ssoRequired(team, true, "Student@UNI.edu")).toBe(true);
  });

  it("leaves other domains, unrequired teams and the owner alone", () => {
    expect(ssoRequired(team, true, "student@gmail.com", 5)).toBe(false);
    expect(ssoRequired(team, true, "student@sub.uni.edu", 5)).toBe(false);
    expect(ssoRequired(team, false, "student@uni.edu", 5)).toBe(false);
    expect(ssoRequired(team, true, "owner@uni.edu", 1)).toBe(false);
    expect(ssoRequired(null, true, "student@uni.edu", 5)).toBe(false);
    expect(ssoRequired({ ...team, workosOrganizationId: null }, true, "student@uni.edu", 5)).toBe(false);
  });

  it("stores the switch per team", () => {
    expect(ssoOnlyKey(42)).toBe("team_sso_only:42");
  });
});

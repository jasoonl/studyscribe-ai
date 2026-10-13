import { describe, expect, it } from "vitest";
import {
  canAddSeatHolder,
  canInviteAs,
  canRemove,
  domainVerificationRecord,
  hasVerificationRecord,
  normalizeTeamDomain,
  orgCan,
  seatSummary,
} from "@shared/organizations";
import { TEAM_PLAN, betterPlan, getPlan } from "@shared/plans";
import { nextTeamState, teamIsEntitled } from "./billingState";
import { profileMatchesTeam, ssoAuthorizeUrl } from "./workos";
import { safeNextPath } from "./googleSignup";
import { teamBilling } from "./organizations";

describe("team roles", () => {
  it("gives members the library only", () => {
    expect(orgCan("member", "view_library")).toBe(true);
    expect(orgCan("member", "share_course")).toBe(true);
    expect(orgCan("member", "invite")).toBe(false);
    expect(orgCan("member", "view_usage")).toBe(false);
  });

  it("lets admins invite, remove members and see usage, but not billing, domain, SSO or deletion", () => {
    for (const action of ["invite", "remove_member", "view_usage", "rename"] as const) expect(orgCan("admin", action)).toBe(true);
    for (const action of ["manage_billing", "manage_domain", "manage_sso", "delete_team", "change_role", "remove_admin"] as const) expect(orgCan("admin", action)).toBe(false);
  });

  it("keeps the owner in place: nobody removes them", () => {
    expect(canRemove("owner", "owner")).toBe(false);
    expect(canRemove("owner", "admin")).toBe(true);
    expect(canRemove("admin", "admin")).toBe(false);
    expect(canRemove("admin", "member")).toBe(true);
    expect(canRemove("member", "member")).toBe(false);
    expect(canInviteAs("member", "member")).toBe(false);
    expect(canInviteAs("admin", "member")).toBe(true);
    expect(orgCan(null, "view_library")).toBe(false);
  });
});

describe("seats", () => {
  const base = { billingConfigured: true, subscriptionActive: true, paidSeats: 3, members: 2, pendingInvites: 0 };

  it("counts members and pending invitations", () => {
    expect(seatSummary({ ...base, pendingInvites: 1 })).toEqual({ limited: true, used: 3, total: 3, available: 0 });
    expect(canAddSeatHolder(base).ok).toBe(true);
    expect(canAddSeatHolder({ ...base, pendingInvites: 1 }).ok).toBe(false);
  });

  it("allows only the owner's seat until the team plan is bought", () => {
    const check = canAddSeatHolder({ ...base, subscriptionActive: false, members: 1 });
    expect(check.ok).toBe(false);
    expect(!check.ok && check.reason).toMatch(/Start the team plan/);
  });

  it("does not limit seats while team billing is not configured", () => {
    expect(seatSummary({ ...base, billingConfigured: false, members: 40 })).toMatchObject({ limited: false, total: null });
    expect(canAddSeatHolder({ ...base, billingConfigured: false, members: 40 }).ok).toBe(true);
  });

  it("is on only with Stripe billing and STRIPE_PRICE_TEAM", () => {
    const stripe = { STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "wh", STRIPE_PRICE_BASIC: "b", STRIPE_PRICE_PRO: "p", STRIPE_PRICE_MAX: "m" };
    expect(teamBilling(stripe as any)).toBeNull();
    expect(teamBilling({ ...stripe, STRIPE_PRICE_TEAM: "price_team" } as any)?.priceId).toBe("price_team");
  });
});

describe("team subscription events", () => {
  const sub = (overrides: Record<string, unknown> = {}) => ({ id: "sub_1", status: "active", current_period_end: 1_900_000_000, items: { data: [{ id: "si_1", quantity: 5, price: { id: "price_team" } }] }, ...overrides });

  it("takes the seat count from the team price's quantity", () => {
    const next = nextTeamState(null, { type: "customer.subscription.updated", created: 100, subscription: sub() }, "price_team");
    expect(next).toMatchObject({ seats: 5, subscriptionStatus: "active", stripeSubscriptionId: "sub_1" });
    expect(teamIsEntitled(next)).toBe(true);
  });

  it("ignores events older than the stored one", () => {
    expect(nextTeamState({ lastEventAt: 200, stripeSubscriptionId: "sub_1", subscriptionStatus: "active" }, { type: "customer.subscription.updated", created: 100, subscription: sub() }, "price_team")).toBeNull();
  });

  it("ends paid seats when the subscription is deleted", () => {
    const next = nextTeamState({ lastEventAt: 100, stripeSubscriptionId: "sub_1", subscriptionStatus: "active" }, { type: "customer.subscription.deleted", created: 200, subscription: sub() }, "price_team");
    expect(next).toMatchObject({ seats: 0, subscriptionStatus: "canceled" });
    expect(teamIsEntitled(next)).toBe(false);
  });

  it("does not let an old subscription's cancellation end a newer live one", () => {
    expect(nextTeamState({ lastEventAt: 100, stripeSubscriptionId: "sub_2", subscriptionStatus: "active" }, { type: "customer.subscription.updated", created: 200, subscription: sub({ status: "canceled" }) }, "price_team")).toBeNull();
  });

  it("gives members the Team allowance when it is larger than their own plan", () => {
    expect(betterPlan(getPlan("free"), TEAM_PLAN).id).toBe("team");
    expect(betterPlan(getPlan("max"), TEAM_PLAN).id).toBe("max");
    expect(getPlan("team")).toBe(TEAM_PLAN);
  });
});

describe("verified domains", () => {
  it("refuses free email providers and malformed names", () => {
    expect(normalizeTeamDomain("@Example.EDU")).toBe("example.edu");
    expect(normalizeTeamDomain("gmail.com")).toBeNull();
    expect(normalizeTeamDomain("not a domain")).toBeNull();
  });

  it("finds the TXT record, even when split into chunks", () => {
    const token = "abc123";
    expect(hasVerificationRecord([["v=spf1 -all"], [domainVerificationRecord(token)]], token)).toBe(true);
    expect(hasVerificationRecord([["studyscribe-verification=", "abc123"]], token)).toBe(true);
    expect(hasVerificationRecord([["studyscribe-verification=other"]], token)).toBe(false);
  });
});

describe("SAML through WorkOS", () => {
  const team = { workosOrganizationId: "org_123", verifiedDomain: "example.edu" };

  it("accepts only profiles from the team's WorkOS organisation and domain", () => {
    expect(profileMatchesTeam({ id: "p", email: "ana@example.edu", firstName: null, lastName: null, organizationId: "org_123" }, team)).toBe(true);
    expect(profileMatchesTeam({ id: "p", email: "ana@example.edu", firstName: null, lastName: null, organizationId: "org_999" }, team)).toBe(false);
    expect(profileMatchesTeam({ id: "p", email: "ana@other.com", firstName: null, lastName: null, organizationId: "org_123" }, team)).toBe(false);
    expect(profileMatchesTeam({ id: "p", email: "ana@example.edu", firstName: null, lastName: null, organizationId: "org_123" }, { ...team, workosOrganizationId: null })).toBe(false);
  });

  it("builds the authorize link for the team's organisation", () => {
    const url = new URL(ssoAuthorizeUrl({ apiKey: "k", clientId: "client_1", apiBase: "https://api.workos.com" }, { organization: "org_123", redirectUri: "https://app.example/api/auth/sso/callback", state: "s" }));
    expect(url.pathname).toBe("/sso/authorize");
    expect(url.searchParams.get("organization")).toBe("org_123");
    expect(url.searchParams.get("client_id")).toBe("client_1");
  });

  it("only returns to paths on this site after sign-in", () => {
    expect(safeNextPath("/team/join/abc")).toBe("/team/join/abc");
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("/\\evil.example")).toBeNull();
  });
});

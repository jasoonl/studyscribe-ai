import { eq } from "drizzle-orm";
import { organizations, type Organization } from "../drizzle/schema";
import { emailDomain } from "@shared/organizations";
import { deleteAppSetting, getAppSetting, getDb, setAppSetting } from "./db";
import { tolerateMissingSchema } from "./schemaTolerance";

/**
 * SSO-only teams (Phase 6). A team owner whose team has a verified domain and
 * a linked WorkOS organisation can require single sign-on: from then on,
 * anyone with an address on that domain must sign in through SSO, and email
 * and password or Google sign-in are refused. The owner keeps their other
 * sign-in methods so a broken identity provider cannot lock the team out
 * ("break glass"). Sessions that already exist stay valid until they expire.
 *
 * Stored as an `appSettings` row per team (`team_sso_only:<id>`), so it needs
 * no migration.
 */

export const ssoOnlyKey = (orgId: number) => `team_sso_only:${orgId}`;

export async function isTeamSsoOnly(orgId: number): Promise<boolean> {
  try {
    return (await getAppSetting(ssoOnlyKey(orgId)))?.value === "1";
  } catch {
    return false;
  }
}

export async function setTeamSsoOnly(orgId: number, on: boolean) {
  if (on) await setAppSetting(ssoOnlyKey(orgId), "1");
  else await deleteAppSetting(ssoOnlyKey(orgId));
}

/** Whether a team can require SSO at all: a verified domain and a linked WorkOS organisation. */
export function canRequireSso(team: Pick<Organization, "verifiedDomain" | "workosOrganizationId">): boolean {
  return Boolean(team.verifiedDomain && team.workosOrganizationId);
}

/**
 * The pure rule: SSO is required for this address when the team that owns its
 * domain can and does require it, unless the person is that team's owner.
 */
export function ssoRequired(
  team: Pick<Organization, "verifiedDomain" | "workosOrganizationId" | "ownerId"> | null,
  ssoOnly: boolean,
  email: string,
  userId?: number | null,
): boolean {
  if (!team || !ssoOnly || !canRequireSso(team)) return false;
  if (emailDomain(email) !== team.verifiedDomain) return false;
  return !(userId && userId === team.ownerId);
}

export const SSO_REQUIRED_MESSAGE = "Your team signs in with single sign-on. Use \"Sign in with SSO\" with your work email.";

/** Checks an address before a password or Google sign-in. Fails open only when the database cannot be read. */
export async function ssoRequiredForEmail(email: string, userId?: number | null): Promise<boolean> {
  const domain = emailDomain(email);
  const db = await getDb();
  if (!domain || !db) return false;
  const rows = await tolerateMissingSchema("teams", () => db.select().from(organizations).where(eq(organizations.verifiedDomain, domain)).limit(1), [] as Organization[]);
  const team = rows[0] ?? null;
  if (!team || !canRequireSso(team)) return false;
  return ssoRequired(team, await isTeamSsoOnly(team.id), email, userId);
}

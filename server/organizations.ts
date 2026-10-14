import { createHash, randomBytes } from "crypto";
import { promises as dns } from "dns";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  courses,
  inviteCodes,
  organizationCourses,
  organizationInvites,
  organizationMembers,
  organizations,
  recordingCourses,
  recordings,
  usageEvents,
  users,
  type Organization,
  type OrganizationInvite,
} from "../drizzle/schema";
import {
  INVITABLE_ROLES,
  canAddSeatHolder,
  canInviteAs,
  canRemove,
  domainVerificationRecord,
  emailDomain,
  hasVerificationRecord,
  normalizeTeamDomain,
  orgCan,
  seatSummary,
  type OrgAction,
  type OrgRole,
} from "@shared/organizations";
import { TEAM_PLAN, getPlan } from "@shared/plans";
import { nextTeamState, teamIsEntitled, type TeamSubscriptionState } from "./billingState";
import { createInviteCode, getDb, getUserByEmail, normalizeAuthEmail } from "./db";
import { generateInviteCode } from "./authService";
import { getSafeApplicationOrigin, isTransactionalEmailConfigured } from "./email";
import { escapeHtml } from "./markdownExport";
import { isOptedOut, oneClickUnsubscribeUrl, postalAddress, unsubscribeUrl } from "./attendeeEmail";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { getStripeConfig, StripeApiError, stripeRequest, type StripeConfig } from "./stripe";
import { usagePeriod } from "./usageRules";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { adminProcedure, protectedProcedure, publicProcedure, router, sessionProcedure } from "./_core/trpc";
import { CONTACT_EMAIL, OPERATOR_NAME } from "@shared/legal";
import { describeWorkosConfig, generateSsoPortalLink, isWorkosConfigured } from "./workos";
import { canRequireSso, isTeamSsoOnly, setTeamSsoOnly } from "./ssoEnforcement";

/**
 * Teams and schools (F3).
 *
 * An organisation has one owner, admins and members (one team per person).
 * Members share courses into the team's library, which every member can open
 * (view only, through `getOrgRole` in recordingAccess.ts). Admins invite
 * people by email and see usage across the team; the owner also manages
 * billing, the verified domain, SSO and deleting the team.
 *
 * Billing is a Stripe subscription on the team's own customer, priced per
 * seat (STRIPE_PRICE_TEAM). Members of a team with a live subscription get
 * the Team plan's allowance. Seats are enforced only when team billing is
 * configured (Phase 5 rule: nothing is billed or limited without its
 * provider); a pending invite holds a seat.
 *
 * Sign-in: a verified domain (TXT record) with auto-join lets Google
 * Workspace accounts from that domain join on their own; SAML goes through
 * WorkOS once the app's admin links a WorkOS organisation (server/workos.ts).
 */

const INVITE_DAYS = 14;

export function teamBilling(env: NodeJS.ProcessEnv = process.env): { config: StripeConfig; priceId: string } | null {
  const config = getStripeConfig(env);
  const priceId = env.STRIPE_PRICE_TEAM?.trim();
  return config && priceId ? { config, priceId } : null;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export async function getMembership(userId: number): Promise<{ org: Organization; role: OrgRole } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await tolerateMissingSchema(
    "teams",
    () =>
      db
        .select({ org: organizations, role: organizationMembers.role })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
        .where(eq(organizationMembers.userId, userId))
        .limit(1),
    [] as Array<{ org: Organization; role: OrgRole }>,
  );
  return rows[0] ?? null;
}

async function requireMembership(userId: number, action?: OrgAction) {
  const membership = await explainMissingSchema("Teams", () => getMembership(userId));
  if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "You are not in a team." });
  if (action && !orgCan(membership.role, action)) throw new TRPCError({ code: "FORBIDDEN", message: membership.role === "member" ? "Only the team's admins can do that." : "Only the team's owner can do that." });
  return membership;
}

async function counts(orgId: number) {
  const db = await requireDb();
  const [[members], [invites]] = await Promise.all([
    db.select({ count: sql<string>`COUNT(*)` }).from(organizationMembers).where(eq(organizationMembers.orgId, orgId)),
    db.select({ count: sql<string>`COUNT(*)` }).from(organizationInvites).where(and(eq(organizationInvites.orgId, orgId), isNull(organizationInvites.acceptedAt), gt(organizationInvites.expiresAt, new Date()))),
  ]);
  return { members: Number(members?.count ?? 0), pendingInvites: Number(invites?.count ?? 0) };
}

async function seatInput(org: Organization) {
  const { members, pendingInvites } = await counts(org.id);
  return { billingConfigured: teamBilling() !== null, subscriptionActive: teamIsEntitled(org), paidSeats: org.seats, members, pendingInvites };
}

/** Whether the team this person is in pays for their plan right now. */
export async function teamPlanFor(userId: number) {
  const membership = await getMembership(userId);
  return membership && teamIsEntitled(membership.org) ? TEAM_PLAN : null;
}

function publicOrg(org: Organization, role: OrgRole) {
  const owner = role === "owner";
  return {
    id: org.id,
    name: org.name,
    role,
    verifiedDomain: org.verifiedDomain,
    pendingDomain: owner ? org.pendingDomain : null,
    domainRecord: owner && org.pendingDomain && org.domainToken ? domainVerificationRecord(org.domainToken) : null,
    autoJoin: org.autoJoin,
    restrictToDomain: org.restrictToDomain,
    sso: { linked: Boolean(org.workosOrganizationId), configured: isWorkosConfigured() },
    subscription: { status: org.subscriptionStatus, active: teamIsEntitled(org), seats: org.seats, currentPeriodEnd: org.currentPeriodEnd, cancelAtPeriodEnd: org.cancelAtPeriodEnd },
  };
}

// ---------------------------------------------------------------- joining

async function addMember(orgId: number, userId: number, role: OrgRole) {
  const db = await requireDb();
  try {
    await db.insert(organizationMembers).values({ orgId, userId, role });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062 || error?.cause?.errno === 1062) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "You are already in a team. Leave it first to join another." });
    }
    throw error;
  }
}

/**
 * The team a Google account may join on its own: the address is on a team's
 * verified domain, the team allows auto-join, Google says the account is
 * managed by that domain (Workspace `hd`), and there is a seat for it.
 */
export async function domainJoinFor(email: string, hostedDomain?: string) {
  const domain = emailDomain(email);
  if (!domain || !hostedDomain || hostedDomain !== domain) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await tolerateMissingSchema("teams", () => db.select().from(organizations).where(eq(organizations.verifiedDomain, domain)).limit(1), [] as Organization[]);
  const org = rows[0];
  if (!org || !org.autoJoin) return null;
  if (!canAddSeatHolder(await seatInput(org)).ok) return null;
  return { id: org.id };
}

export async function joinOrganizationByDomain(orgId: number, userId: number) {
  await addMember(orgId, userId, "member");
}

/** On Google sign-in: a person in no team whose Workspace domain auto-joins a team is added to it. */
export async function autoJoinByDomain(user: { id: number; email: string }, hostedDomain?: string) {
  try {
    if (await getMembership(user.id)) return;
    const org = await domainJoinFor(user.email, hostedDomain);
    if (org) await addMember(org.id, user.id, "member");
  } catch (error) {
    console.warn("[teams] auto-join failed:", error instanceof Error ? error.message : error);
  }
}

/** Used by SAML sign-in: puts a person in the team their identity provider belongs to, if they are in none and a seat is free. */
export async function ensureSsoMembership(orgId: number, userId: number) {
  const existing = await getMembership(userId);
  if (existing) return existing.org.id === orgId;
  const db = await requireDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org || !canAddSeatHolder(await seatInput(org)).ok) return false;
  await addMember(orgId, userId, "member");
  return true;
}

// ------------------------------------------------------------------ email

function inviteEmail(input: { orgName: string; inviterName: string; link: string; recipient: string; origin: string }) {
  const postal = postalAddress();
  const stop = unsubscribeUrl(input.recipient, input.origin);
  return {
    subject: `${input.inviterName} invited you to ${input.orgName} on StudyScribe`,
    html: `<!doctype html><html lang="en"><body style="margin:0;padding:32px 16px;background:#f5f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<main style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e7ef;border-radius:14px;padding:32px;">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;">Join ${escapeHtml(input.orgName)} on StudyScribe</h1>
<p style="margin:0 0 22px;line-height:1.6;">${escapeHtml(input.inviterName)} invited you to their team, where you can share course recordings, transcripts and notes.</p>
<p style="margin:0 0 22px;"><a href="${escapeHtml(input.link)}" style="display:inline-block;border-radius:10px;background:#1d4ed8;color:#ffffff;padding:12px 18px;text-decoration:none;font-weight:600;">Open the invitation</a></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#596579;">The invitation works for this email address and expires in ${INVITE_DAYS} days. If you were not expecting it, ignore this email.</p>
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e3e7ef;font-size:12px;line-height:1.6;color:#596579;">
<a href="${escapeHtml(stop)}" style="color:#1d4ed8;">Don't email me from StudyScribe</a>. ${escapeHtml(OPERATOR_NAME)}${postal ? `, ${escapeHtml(postal)}` : ""}. Questions: <a href="mailto:${CONTACT_EMAIL}" style="color:#1d4ed8;">${CONTACT_EMAIL}</a></p>
</main></body></html>`,
    unsubscribe: stop,
  };
}

async function sendInviteEmail(input: { to: string; orgName: string; inviterName: string; link: string; origin: string }) {
  if (!isTransactionalEmailConfigured()) return false;
  if (await isOptedOut(input.to)) return false;
  const built = inviteEmail({ ...input, recipient: input.to });
  const endpoint = (process.env.NODE_ENV !== "production" ? process.env.RESEND_TEST_ENDPOINT?.trim() : undefined) || "https://api.resend.com/emails";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [input.to],
      subject: built.subject,
      html: built.html,
      headers: { "List-Unsubscribe": `<${oneClickUnsubscribeUrl(input.to, input.origin)}>, <${built.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return Boolean(response?.ok);
}

// ------------------------------------------------------------------- DNS

/** TXT records at a domain. Outside production, DNS_TXT_TEST_RECORDS (JSON {domain: [values]}) stands in for DNS. */
export async function lookupTxt(domain: string): Promise<string[][]> {
  if (process.env.NODE_ENV !== "production" && process.env.DNS_TXT_TEST_RECORDS) {
    try {
      // Either the JSON itself or the path of a JSON file (read on every check, so it can change while the app runs).
      const source = process.env.DNS_TXT_TEST_RECORDS.trim();
      const text = source.startsWith("{") ? source : (await import("fs")).readFileSync(source, "utf8");
      const table = JSON.parse(text) as Record<string, string[]>;
      return (table[domain] ?? []).map((value) => [value]);
    } catch {
      return [];
    }
  }
  try {
    return await dns.resolveTxt(domain);
  } catch {
    return [];
  }
}

// --------------------------------------------------------------- billing

async function ensureTeamCustomer(org: Organization, owner: { email: string; name: string | null }, config: StripeConfig) {
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const db = await requireDb();
  const customer = await stripeRequest<{ id: string }>(
    "POST",
    "/customers",
    { email: owner.email, name: org.name, metadata: { orgId: String(org.id), kind: "team" } },
    { idempotencyKey: `studyscribe-team-customer-${org.id}`, config },
  );
  await db.update(organizations).set({ stripeCustomerId: customer.id }).where(and(eq(organizations.id, org.id), isNull(organizations.stripeCustomerId)));
  const [fresh] = await db.select({ id: organizations.stripeCustomerId }).from(organizations).where(eq(organizations.id, org.id)).limit(1);
  return fresh?.id ?? customer.id;
}

/**
 * Applies a Stripe event to a team, or returns null when the event is not a
 * team's (so the personal-plan handler takes it). A team event is one whose
 * customer is a team's, or whose metadata names a team.
 */
export async function applyTeamStripeEvent(event: { type: string; created: number; data: { object: any } }, config: StripeConfig): Promise<{ applied: boolean; reason?: string } | null> {
  const billing = teamBilling();
  const object = event.data?.object ?? {};
  const db = await getDb();
  if (!db) return null;
  const customerId: string | null = typeof object.customer === "string" ? object.customer : null;
  const metaOrg = Number(object.metadata?.orgId ?? object.subscription_details?.metadata?.orgId);
  const rows = await tolerateMissingSchema(
    "teams",
    () =>
      customerId
        ? db.select().from(organizations).where(eq(organizations.stripeCustomerId, customerId)).limit(1)
        : Promise.resolve([] as Organization[]),
    [] as Organization[],
  );
  let org = rows[0];
  if (!org && Number.isInteger(metaOrg) && metaOrg > 0) {
    [org] = await tolerateMissingSchema("teams", () => db.select().from(organizations).where(eq(organizations.id, metaOrg)).limit(1), [] as Organization[]);
  }
  if (!org) return null;
  if (!billing) return { applied: false, reason: "team billing not configured" };

  let subscription: any = null;
  if (event.type === "checkout.session.completed") {
    if (object.mode !== "subscription" || typeof object.subscription !== "string") return { applied: false, reason: "not a subscription checkout" };
    subscription = await stripeRequest("GET", `/subscriptions/${encodeURIComponent(object.subscription)}`, {}, { config });
    if (!org.stripeCustomerId && customerId) await db.update(organizations).set({ stripeCustomerId: customerId }).where(eq(organizations.id, org.id));
  } else if (event.type.startsWith("customer.subscription.")) {
    subscription = object;
  } else if (event.type === "invoice.payment_failed") {
    if (org.subscriptionStatus === "active" && org.lastEventAt <= event.created) {
      await db.update(organizations).set({ subscriptionStatus: "past_due", lastEventAt: event.created }).where(eq(organizations.id, org.id));
    }
    return { applied: true };
  } else {
    return { applied: false, reason: "ignored type" };
  }
  const next = nextTeamState(org, { type: event.type, created: event.created, subscription }, billing.priceId);
  if (!next) return { applied: false, reason: "stale" };
  await db.update(organizations).set(next).where(eq(organizations.id, org.id));
  return { applied: true };
}

/** Before a team is deleted: stop its subscription (aborts if Stripe cannot be reached), then remove the customer. */
async function cancelTeamBilling(org: Organization) {
  const config = getStripeConfig();
  const live = org.stripeSubscriptionId && teamIsEntitled(org);
  if (live) {
    if (!config) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The team's subscription could not be cancelled automatically. Email us to cancel it, then delete the team." });
    try {
      await stripeRequest("DELETE", `/subscriptions/${encodeURIComponent(org.stripeSubscriptionId!)}`, {}, { config });
    } catch (error) {
      if (!(error instanceof StripeApiError && error.status === 404)) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: "We could not cancel the team's subscription with Stripe, so nothing was deleted. Try again in a moment." });
      }
    }
  }
  if (config && org.stripeCustomerId) {
    await stripeRequest("DELETE", `/customers/${encodeURIComponent(org.stripeCustomerId)}`, {}, { config }).catch(() => undefined);
  }
}

async function deleteOrganization(org: Organization) {
  await cancelTeamBilling(org);
  const db = await requireDb();
  await db.delete(organizationCourses).where(eq(organizationCourses.orgId, org.id));
  await db.delete(organizationInvites).where(eq(organizationInvites.orgId, org.id));
  await db.delete(organizationMembers).where(eq(organizationMembers.orgId, org.id));
  await db.delete(organizations).where(eq(organizations.id, org.id));
  await setTeamSsoOnly(org.id, false).catch(() => undefined);
}

/** A person leaving (or removed): their courses leave the library with them. */
async function removeMemberRows(orgId: number, userId: number) {
  const db = await requireDb();
  await db.delete(organizationCourses).where(and(eq(organizationCourses.orgId, orgId), eq(organizationCourses.sharedBy, userId)));
  await db.delete(organizationMembers).where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
}

// ----------------------------------------------------------------- router

const nameInput = z.string().trim().min(2).max(120);

export const teamsRouter = router({
  /** The person's team (or none) and what this server can do for teams. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const available = db
      ? await tolerateMissingSchema("teams", async () => {
          await db.select({ id: organizations.id }).from(organizations).limit(1);
          return true;
        }, false)
      : false;
    const membership = available ? await getMembership(ctx.user.id) : null;
    const pending = available
      ? await tolerateMissingSchema(
          "teams",
          () =>
            db!
              .select({ id: organizationInvites.id, orgName: organizations.name, role: organizationInvites.role })
              .from(organizationInvites)
              .innerJoin(organizations, eq(organizations.id, organizationInvites.orgId))
              .where(and(eq(organizationInvites.email, ctx.user.email.toLowerCase()), isNull(organizationInvites.acceptedAt), gt(organizationInvites.expiresAt, new Date()))),
          [] as Array<{ id: number; orgName: string; role: string }>,
        )
      : [];
    const requiredSso = membership ? await isTeamSsoOnly(membership.org.id) : false;
    return {
      available,
      billingConfigured: teamBilling() !== null,
      ssoConfigured: isWorkosConfigured(),
      emailConfigured: isTransactionalEmailConfigured(),
      plan: { name: TEAM_PLAN.name, priceMonthlyUsd: TEAM_PLAN.priceMonthlyUsd, transcriptionMinutesPerMonth: TEAM_PLAN.transcriptionMinutesPerMonth, aiGenerationsPerMonth: TEAM_PLAN.aiGenerationsPerMonth },
      org: membership
        ? (() => {
            const shaped = publicOrg(membership.org, membership.role);
            return { ...shaped, sso: { ...shaped.sso, canRequire: canRequireSso(membership.org) && isWorkosConfigured(), required: requiredSso } };
          })()
        : null,
      seats: membership ? seatSummary(await seatInput(membership.org)) : null,
      pendingInvites: membership ? [] : pending,
    };
  }),

  create: protectedProcedure.input(z.object({ name: nameInput })).mutation(async ({ ctx, input }) => {
    if (!checkTrpcRateLimit(`team-create:${ctx.user.id}`, 60 * 60 * 1000, 5)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many teams created. Try again later." });
    const db = await requireDb();
    return explainMissingSchema("Teams", async () => {
      if (await getMembership(ctx.user.id)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "You are already in a team. Leave it first to start another." });
      const inserted: any = await db.insert(organizations).values({ name: input.name, ownerId: ctx.user.id });
      const orgId = Number(Array.isArray(inserted) ? inserted[0]?.insertId : inserted?.insertId);
      try {
        await addMember(orgId, ctx.user.id, "owner");
      } catch (error) {
        await db.delete(organizations).where(eq(organizations.id, orgId));
        throw error;
      }
      return { id: orgId };
    });
  }),

  rename: protectedProcedure.input(z.object({ name: nameInput })).mutation(async ({ ctx, input }) => {
    const { org } = await requireMembership(ctx.user.id, "rename");
    const db = await requireDb();
    await db.update(organizations).set({ name: input.name }).where(eq(organizations.id, org.id));
    return { name: input.name };
  }),

  /** Everyone in the team. Admins also see each person's usage this month. */
  members: protectedProcedure.query(async ({ ctx }) => {
    const { org, role } = await requireMembership(ctx.user.id, "view_library");
    const db = await requireDb();
    const rows = await db
      .select({ userId: organizationMembers.userId, role: organizationMembers.role, joinedAt: organizationMembers.createdAt, name: users.name, email: users.email, lastSignedIn: users.lastSignedIn })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.orgId, org.id))
      .orderBy(asc(organizationMembers.createdAt));
    const showUsage = orgCan(role, "view_usage");
    const usage = showUsage && rows.length ? await usageByUser(rows.map((row) => row.userId)) : new Map<number, { minutes: number; generations: number; recordings: number }>();
    const order: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2 };
    return rows
      .sort((a, b) => order[a.role] - order[b.role])
      .map((row) => ({
        userId: row.userId,
        name: row.name,
        email: row.email,
        role: row.role,
        joinedAt: row.joinedAt,
        lastActive: showUsage ? row.lastSignedIn : null,
        usage: showUsage ? usage.get(row.userId) ?? { minutes: 0, generations: 0, recordings: 0 } : null,
        isYou: row.userId === ctx.user.id,
      }));
  }),

  /** Admin console totals: this month across the team. */
  usage: protectedProcedure.query(async ({ ctx }) => {
    const { org } = await requireMembership(ctx.user.id, "view_usage");
    const db = await requireDb();
    const memberIds = (await db.select({ userId: organizationMembers.userId }).from(organizationMembers).where(eq(organizationMembers.orgId, org.id))).map((row) => row.userId);
    const usage = await usageByUser(memberIds);
    let minutes = 0;
    let generations = 0;
    let recordingsCount = 0;
    usage.forEach((value) => {
      minutes += value.minutes;
      generations += value.generations;
      recordingsCount += value.recordings;
    });
    const plan = teamIsEntitled(org) ? TEAM_PLAN : getPlan("free");
    return { period: usagePeriod(), members: memberIds.length, minutes, generations, recordings: recordingsCount, perMember: { minutes: plan.transcriptionMinutesPerMonth, generations: plan.aiGenerationsPerMonth, planName: plan.name } };
  }),

  invites: protectedProcedure.query(async ({ ctx }) => {
    const { org } = await requireMembership(ctx.user.id, "invite");
    const db = await requireDb();
    const rows = await db
      .select()
      .from(organizationInvites)
      .where(and(eq(organizationInvites.orgId, org.id), isNull(organizationInvites.acceptedAt), gt(organizationInvites.expiresAt, new Date())))
      .orderBy(desc(organizationInvites.createdAt));
    return rows.map((row) => ({ id: row.id, email: row.email, role: row.role, expiresAt: row.expiresAt, createdAt: row.createdAt }));
  }),

  /** Returns the invitation link (shown once), and emails it when Resend is configured. */
  invite: protectedProcedure.input(z.object({ email: z.string().trim().email().max(320), role: z.enum(INVITABLE_ROLES).default("member") })).mutation(async ({ ctx, input }) => {
    const { org, role } = await requireMembership(ctx.user.id, "invite");
    if (!canInviteAs(role, input.role)) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot invite people with that role." });
    if (!checkTrpcRateLimit(`team-invite:${org.id}`, 60 * 60 * 1000, 50)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many invitations this hour. Try again later." });
    const email = normalizeAuthEmail(input.email);
    if (org.restrictToDomain && org.verifiedDomain && emailDomain(email) !== org.verifiedDomain) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `This team only accepts @${org.verifiedDomain} addresses.` });
    }
    const db = await requireDb();
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      const theirs = await getMembership(existingUser.id);
      if (theirs?.org.id === org.id) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "They are already in this team." });
    }
    const [pending] = await db.select({ id: organizationInvites.id }).from(organizationInvites).where(and(eq(organizationInvites.orgId, org.id), eq(organizationInvites.email, email), isNull(organizationInvites.acceptedAt), gt(organizationInvites.expiresAt, new Date()))).limit(1);
    if (pending) await db.delete(organizationInvites).where(eq(organizationInvites.id, pending.id));
    const seats = canAddSeatHolder(await seatInput(org));
    if (!seats.ok) throw new TRPCError({ code: "PRECONDITION_FAILED", message: seats.reason });

    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60_000);
    await db.insert(organizationInvites).values({ orgId: org.id, email, role: input.role, tokenHash: hashToken(token), invitedBy: ctx.user.id, expiresAt });
    // Someone without an account also gets a sign-up invite for the same address (sign-up is invite-only).
    if (!existingUser) {
      await createInviteCode({ code: generateInviteCode(), email, createdBy: ctx.user.id, expiresAt }).catch((error) => {
        console.warn("[teams] could not create a sign-up invite:", error instanceof Error ? error.message : error);
      });
    }
    const origin = getSafeApplicationOrigin(typeof ctx.req.headers.origin === "string" ? ctx.req.headers.origin : undefined);
    const link = `${origin}/team/join/${token}`;
    const emailed = await sendInviteEmail({ to: email, orgName: org.name, inviterName: ctx.user.name || ctx.user.email, link, origin });
    return { link, emailed };
  }),

  revokeInvite: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const { org } = await requireMembership(ctx.user.id, "invite");
    const db = await requireDb();
    await db.delete(organizationInvites).where(and(eq(organizationInvites.id, input.id), eq(organizationInvites.orgId, org.id), isNull(organizationInvites.acceptedAt)));
    return { revoked: true };
  }),

  /** Public: what an invitation is for, so the join page can say so before anyone signs in. */
  invitePreview: publicProcedure.input(z.object({ token: z.string().min(16).max(100) })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return null;
    const rows = await tolerateMissingSchema(
      "teams",
      () =>
        db
          .select({ invite: organizationInvites, orgName: organizations.name, inviterName: users.name })
          .from(organizationInvites)
          .innerJoin(organizations, eq(organizations.id, organizationInvites.orgId))
          .leftJoin(users, eq(users.id, organizationInvites.invitedBy))
          .where(eq(organizationInvites.tokenHash, hashToken(input.token)))
          .limit(1),
      [] as Array<{ invite: OrganizationInvite; orgName: string; inviterName: string | null }>,
    );
    const row = rows[0];
    if (!row) return null;
    const expired = row.invite.expiresAt < new Date();
    const accepted = Boolean(row.invite.acceptedAt);
    // The sign-up code for this address, so someone without an account can create one.
    let signupCode: string | null = null;
    if (!ctx.user && !expired && !accepted && !(await getUserByEmail(row.invite.email))) {
      const [code] = await db.select({ code: inviteCodes.code }).from(inviteCodes).where(and(eq(inviteCodes.email, row.invite.email), eq(inviteCodes.isUsed, 0), gt(inviteCodes.expiresAt, new Date()))).orderBy(desc(inviteCodes.createdAt)).limit(1);
      signupCode = code?.code ?? null;
    }
    const [local, domain] = row.invite.email.split("@");
    return {
      orgName: row.orgName,
      inviterName: row.inviterName,
      role: row.invite.role,
      email: ctx.user ? row.invite.email : `${local.slice(0, 1)}***@${domain}`,
      expired,
      accepted,
      signupCode,
      matchesYou: ctx.user ? ctx.user.email.toLowerCase() === row.invite.email : null,
    };
  }),

  acceptInvite: protectedProcedure.input(z.object({ token: z.string().min(16).max(100) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [invite] = await explainMissingSchema("Teams", () => db.select().from(organizationInvites).where(eq(organizationInvites.tokenHash, hashToken(input.token))).limit(1));
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new TRPCError({ code: "NOT_FOUND", message: "This invitation is no longer valid. Ask for a new one." });
    if (invite.email !== ctx.user.email.toLowerCase()) throw new TRPCError({ code: "FORBIDDEN", message: `This invitation is for ${invite.email}. Sign in with that account to accept it.` });
    if (await getMembership(ctx.user.id)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "You are already in a team. Leave it first to join another." });
    const claim: any = await db.update(organizationInvites).set({ acceptedAt: new Date() }).where(and(eq(organizationInvites.id, invite.id), isNull(organizationInvites.acceptedAt)));
    if ((Array.isArray(claim) ? claim[0]?.affectedRows : claim?.affectedRows) !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "This invitation was already used." });
    try {
      await addMember(invite.orgId, ctx.user.id, invite.role);
    } catch (error) {
      await db.update(organizationInvites).set({ acceptedAt: null }).where(eq(organizationInvites.id, invite.id));
      throw error;
    }
    return { orgId: invite.orgId };
  }),

  /** Owner only: make someone an admin or a member. */
  setRole: protectedProcedure.input(z.object({ userId: z.number().int().positive(), role: z.enum(INVITABLE_ROLES) })).mutation(async ({ ctx, input }) => {
    const { org } = await requireMembership(ctx.user.id, "change_role");
    if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Transfer ownership instead." });
    const db = await requireDb();
    await db.update(organizationMembers).set({ role: input.role }).where(and(eq(organizationMembers.orgId, org.id), eq(organizationMembers.userId, input.userId), inArray(organizationMembers.role, ["admin", "member"])));
    return { role: input.role };
  }),

  /** Owner only: hand the team to another member, who becomes owner; the old owner becomes an admin. */
  transferOwnership: sessionProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const { org } = await requireMembership(ctx.user.id, "delete_team");
    const db = await requireDb();
    const [target] = await db.select().from(organizationMembers).where(and(eq(organizationMembers.orgId, org.id), eq(organizationMembers.userId, input.userId))).limit(1);
    if (!target || target.userId === ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "That person is not in this team." });
    await db.update(organizationMembers).set({ role: "owner" }).where(eq(organizationMembers.id, target.id));
    await db.update(organizationMembers).set({ role: "admin" }).where(and(eq(organizationMembers.orgId, org.id), eq(organizationMembers.userId, ctx.user.id)));
    await db.update(organizations).set({ ownerId: target.userId }).where(eq(organizations.id, org.id));
    return { ownerId: target.userId };
  }),

  removeMember: protectedProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const { org, role } = await requireMembership(ctx.user.id);
    const db = await requireDb();
    const [target] = await db.select().from(organizationMembers).where(and(eq(organizationMembers.orgId, org.id), eq(organizationMembers.userId, input.userId))).limit(1);
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "That person is not in this team." });
    if (target.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Use Leave team instead." });
    if (!canRemove(role, target.role)) throw new TRPCError({ code: "FORBIDDEN", message: target.role === "owner" ? "The owner cannot be removed." : "Only the owner can remove an admin." });
    await removeMemberRows(org.id, target.userId);
    return { removed: true };
  }),

  leave: protectedProcedure.mutation(async ({ ctx }) => {
    const { org, role } = await requireMembership(ctx.user.id);
    if (role === "owner") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Transfer ownership to someone else first, or delete the team." });
    await removeMemberRows(org.id, ctx.user.id);
    return { left: true };
  }),

  deleteTeam: sessionProcedure.input(z.object({ confirmName: z.string().max(120) })).mutation(async ({ ctx, input }) => {
    const { org } = await requireMembership(ctx.user.id, "delete_team");
    if (input.confirmName.trim() !== org.name) throw new TRPCError({ code: "BAD_REQUEST", message: "Type the team's name exactly to confirm." });
    await deleteOrganization(org);
    return { deleted: true };
  }),

  // ------------------------------------------------------------ library

  library: protectedProcedure.query(async ({ ctx }) => {
    const { org, role } = await requireMembership(ctx.user.id, "view_library");
    const db = await requireDb();
    const rows = await db
      .select({ courseId: courses.id, name: courses.name, color: courses.color, term: courses.term, sharedBy: organizationCourses.sharedBy, sharedByName: users.name, sharedAt: organizationCourses.createdAt, ownerId: courses.userId })
      .from(organizationCourses)
      .innerJoin(courses, eq(courses.id, organizationCourses.courseId))
      .innerJoin(organizationMembers, and(eq(organizationMembers.userId, courses.userId), eq(organizationMembers.orgId, org.id)))
      .leftJoin(users, eq(users.id, courses.userId))
      .where(eq(organizationCourses.orgId, org.id))
      .orderBy(asc(courses.name));
    const ids = rows.map((row) => row.courseId);
    const countRows = ids.length
      ? await db
          .select({ courseId: recordingCourses.courseId, count: sql<string>`COUNT(*)` })
          .from(recordingCourses)
          .innerJoin(recordings, and(eq(recordings.id, recordingCourses.recordingId), eq(recordings.isDeleted, 0)))
          .where(inArray(recordingCourses.courseId, ids))
          .groupBy(recordingCourses.courseId)
      : [];
    const countBy = new Map(countRows.map((row) => [row.courseId, Number(row.count)]));
    return rows.map((row) => ({
      courseId: row.courseId,
      name: row.name,
      color: row.color,
      term: row.term,
      sharedByName: row.sharedByName ?? "A teammate",
      sharedAt: row.sharedAt,
      recordings: countBy.get(row.courseId) ?? 0,
      yours: row.ownerId === ctx.user.id,
      canRemove: row.ownerId === ctx.user.id || orgCan(role, "remove_member"),
    }));
  }),

  courseRecordings: protectedProcedure.input(z.object({ courseId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const { org } = await requireMembership(ctx.user.id, "view_library");
    const db = await requireDb();
    const [course] = await db
      .select({ id: courses.id, name: courses.name, color: courses.color, term: courses.term, ownerName: users.name })
      .from(organizationCourses)
      .innerJoin(courses, eq(courses.id, organizationCourses.courseId))
      .innerJoin(organizationMembers, and(eq(organizationMembers.userId, courses.userId), eq(organizationMembers.orgId, org.id)))
      .leftJoin(users, eq(users.id, courses.userId))
      .where(and(eq(organizationCourses.orgId, org.id), eq(organizationCourses.courseId, input.courseId)))
      .limit(1);
    if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "That course is not in your team's library." });
    const rows = await db
      .select({ id: recordings.id, title: recordings.title, duration: recordings.duration, status: recordings.status, createdAt: recordings.createdAt })
      .from(recordingCourses)
      .innerJoin(recordings, and(eq(recordings.id, recordingCourses.recordingId), eq(recordings.isDeleted, 0)))
      .where(eq(recordingCourses.courseId, course.id))
      .orderBy(desc(recordings.createdAt));
    return { course, recordings: rows };
  }),

  shareCourse: protectedProcedure.input(z.object({ courseId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const { org } = await requireMembership(ctx.user.id, "share_course");
    const db = await requireDb();
    const [course] = await db.select({ id: courses.id }).from(courses).where(and(eq(courses.id, input.courseId), eq(courses.userId, ctx.user.id))).limit(1);
    if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
    await db.insert(organizationCourses).values({ orgId: org.id, courseId: course.id, sharedBy: ctx.user.id }).onDuplicateKeyUpdate({ set: { sharedBy: sql`sharedBy` } });
    return { shared: true };
  }),

  unshareCourse: protectedProcedure.input(z.object({ courseId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const { org, role } = await requireMembership(ctx.user.id, "view_library");
    const db = await requireDb();
    const [row] = await db.select({ id: organizationCourses.id, ownerId: courses.userId }).from(organizationCourses).innerJoin(courses, eq(courses.id, organizationCourses.courseId)).where(and(eq(organizationCourses.orgId, org.id), eq(organizationCourses.courseId, input.courseId))).limit(1);
    if (!row) return { removed: false };
    if (row.ownerId !== ctx.user.id && !orgCan(role, "remove_member")) throw new TRPCError({ code: "FORBIDDEN", message: "Only the course's owner or an admin can take it out of the library." });
    await db.delete(organizationCourses).where(eq(organizationCourses.id, row.id));
    return { removed: true };
  }),

  /** The person's own courses with whether each is in the team library. */
  myCourses: protectedProcedure.query(async ({ ctx }) => {
    const membership = await getMembership(ctx.user.id);
    if (!membership) return [];
    const db = await requireDb();
    const own = await db.select({ id: courses.id, name: courses.name, color: courses.color, archived: courses.archived }).from(courses).where(eq(courses.userId, ctx.user.id)).orderBy(asc(courses.name));
    const shared = new Set((await db.select({ courseId: organizationCourses.courseId }).from(organizationCourses).where(eq(organizationCourses.orgId, membership.org.id))).map((row) => row.courseId));
    return own.filter((course) => !course.archived).map((course) => ({ ...course, inLibrary: shared.has(course.id) }));
  }),

  // ------------------------------------------------------------- domain

  startDomainVerification: protectedProcedure.input(z.object({ domain: z.string().max(253) })).mutation(async ({ ctx, input }) => {
    const { org } = await requireMembership(ctx.user.id, "manage_domain");
    const domain = normalizeTeamDomain(input.domain);
    if (!domain) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a domain your school or company owns, like example.edu. Free email domains such as gmail.com cannot be used." });
    const db = await requireDb();
    const [taken] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.verifiedDomain, domain)).limit(1);
    if (taken && taken.id !== org.id) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Another team has already verified that domain." });
    const token = randomBytes(16).toString("hex");
    await db.update(organizations).set({ pendingDomain: domain, domainToken: token }).where(eq(organizations.id, org.id));
    return { domain, record: domainVerificationRecord(token) };
  }),

  checkDomain: protectedProcedure.mutation(async ({ ctx }) => {
    const { org } = await requireMembership(ctx.user.id, "manage_domain");
    if (!org.pendingDomain || !org.domainToken) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Start by entering your domain." });
    if (!checkTrpcRateLimit(`team-domain:${org.id}`, 10 * 60 * 1000, 20)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Checked too often. Try again in a few minutes." });
    const records = await lookupTxt(org.pendingDomain);
    if (!hasVerificationRecord(records, org.domainToken)) {
      return { verified: false as const, message: `We could not find the TXT record on ${org.pendingDomain} yet. DNS changes can take up to an hour; try again later.` };
    }
    const db = await requireDb();
    try {
      await db.update(organizations).set({ verifiedDomain: org.pendingDomain, domainVerifiedAt: new Date(), pendingDomain: null, domainToken: null }).where(eq(organizations.id, org.id));
    } catch {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Another team has already verified that domain." });
    }
    return { verified: true as const, message: `${org.pendingDomain} is verified.` };
  }),

  setDomainOptions: protectedProcedure.input(z.object({ autoJoin: z.boolean(), restrictToDomain: z.boolean() })).mutation(async ({ ctx, input }) => {
    const { org } = await requireMembership(ctx.user.id, "manage_domain");
    if (!org.verifiedDomain && (input.autoJoin || input.restrictToDomain)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Verify a domain first." });
    const db = await requireDb();
    await db.update(organizations).set(input).where(eq(organizations.id, org.id));
    return input;
  }),

  removeDomain: protectedProcedure.mutation(async ({ ctx }) => {
    const { org } = await requireMembership(ctx.user.id, "manage_domain");
    const db = await requireDb();
    await db.update(organizations).set({ verifiedDomain: null, domainVerifiedAt: null, pendingDomain: null, domainToken: null, autoJoin: false, restrictToDomain: false }).where(eq(organizations.id, org.id));
    return { removed: true };
  }),

  // ------------------------------------------------------------ billing

  checkout: sessionProcedure.input(z.object({ seats: z.number().int().min(1).max(1000) })).mutation(async ({ ctx, input }) => {
    const billing = teamBilling();
    if (!billing) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The team plan is not on sale yet." });
    const { org } = await requireMembership(ctx.user.id, "manage_billing");
    if (teamIsEntitled(org)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The team plan is already active. Change the number of seats instead." });
    const { members, pendingInvites } = await counts(org.id);
    if (input.seats < members + pendingInvites) throw new TRPCError({ code: "BAD_REQUEST", message: `Choose at least ${members + pendingInvites} seats: one for each member and pending invitation.` });
    const origin = getSafeApplicationOrigin(typeof ctx.req.headers.origin === "string" ? ctx.req.headers.origin : undefined);
    try {
      const customer = await ensureTeamCustomer(org, ctx.user, billing.config);
      const session = await stripeRequest<{ url: string }>(
        "POST",
        "/checkout/sessions",
        {
          mode: "subscription",
          customer,
          client_reference_id: `team-${org.id}`,
          line_items: [{ price: billing.priceId, quantity: input.seats }],
          allow_promotion_codes: true,
          automatic_tax: { enabled: billing.config.automaticTax },
          ...(billing.config.automaticTax ? { customer_update: { address: "auto", name: "auto" }, billing_address_collection: "required" } : {}),
          subscription_data: { metadata: { orgId: String(org.id), kind: "team" } },
          metadata: { orgId: String(org.id), kind: "team" },
          success_url: `${origin}/team?checkout=success`,
          cancel_url: `${origin}/team?checkout=cancelled`,
          custom_text: { submit: { message: `The StudyScribe Team plan renews every month for ${input.seats} ${input.seats === 1 ? "seat" : "seats"}, plus any tax shown above, until you cancel. Change seats or cancel any time from the team console.` } },
        },
        { config: billing.config },
      );
      if (!session?.url) throw new Error("Stripe returned no checkout URL");
      return { url: session.url };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error("[teams] checkout failed:", error instanceof Error ? error.message : error);
      throw new TRPCError({ code: "BAD_GATEWAY", message: "Could not start checkout right now. Nothing was charged." });
    }
  }),

  portal: sessionProcedure.mutation(async ({ ctx }) => {
    const billing = teamBilling();
    if (!billing) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The team plan is not on sale yet." });
    const { org } = await requireMembership(ctx.user.id, "manage_billing");
    if (!org.stripeCustomerId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The team has no subscription yet." });
    const origin = getSafeApplicationOrigin(typeof ctx.req.headers.origin === "string" ? ctx.req.headers.origin : undefined);
    try {
      const session = await stripeRequest<{ url: string }>("POST", "/billing_portal/sessions", { customer: org.stripeCustomerId, return_url: `${origin}/team` }, { config: billing.config });
      return { url: session.url };
    } catch (error) {
      console.error("[teams] portal failed:", error instanceof Error ? error.message : error);
      throw new TRPCError({ code: "BAD_GATEWAY", message: "Could not open billing right now." });
    }
  }),

  /** Changes the number of paid seats (prorated by Stripe); never below the seats in use. */
  setSeats: sessionProcedure.input(z.object({ seats: z.number().int().min(1).max(1000) })).mutation(async ({ ctx, input }) => {
    const billing = teamBilling();
    if (!billing) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The team plan is not on sale yet." });
    const { org } = await requireMembership(ctx.user.id, "manage_billing");
    if (!org.stripeSubscriptionId || !teamIsEntitled(org)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Start the team plan first." });
    const { members, pendingInvites } = await counts(org.id);
    if (input.seats < members + pendingInvites) throw new TRPCError({ code: "BAD_REQUEST", message: `${members + pendingInvites} seats are in use. Remove people or invitations before going lower.` });
    try {
      const subscription = await stripeRequest("GET", `/subscriptions/${encodeURIComponent(org.stripeSubscriptionId)}`, {}, { config: billing.config });
      const item = (subscription?.items?.data ?? []).find((candidate: any) => candidate?.price?.id === billing.priceId) ?? subscription?.items?.data?.[0];
      if (!item?.id) throw new Error("No subscription item");
      const updated = await stripeRequest("POST", `/subscriptions/${encodeURIComponent(org.stripeSubscriptionId)}`, { items: [{ id: item.id, quantity: input.seats }], proration_behavior: "create_prorations" }, { config: billing.config, idempotencyKey: `team-seats-${org.id}-${input.seats}-${Date.now() >> 16}` });
      const next = nextTeamState(null, { type: "customer.subscription.updated", created: Math.max(org.lastEventAt, Math.floor(Date.now() / 1000)), subscription: updated }, billing.priceId);
      const db = await requireDb();
      if (next) await db.update(organizations).set(next).where(eq(organizations.id, org.id));
      return { seats: next?.seats ?? input.seats };
    } catch (error) {
      console.error("[teams] seat change failed:", error instanceof Error ? error.message : error);
      throw new TRPCError({ code: "BAD_GATEWAY", message: "Could not change seats right now. Nothing was charged." });
    }
  }),

  // ---------------------------------------------------------------- SSO

  /** WorkOS's Admin Portal, where the team's IT admin connects their identity provider. */
  ssoPortal: sessionProcedure.mutation(async ({ ctx }) => {
    const { org } = await requireMembership(ctx.user.id, "manage_sso");
    if (!isWorkosConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SAML sign-in is not set up on this server yet." });
    if (!org.workosOrganizationId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Ask StudyScribe to turn on SAML for your team first." });
    return { url: await generateSsoPortalLink(org.workosOrganizationId) };
  }),

  /**
   * Require single sign-on for the team's domain (owner only). Needs a verified
   * domain and a linked WorkOS organisation; the owner keeps other sign-in
   * methods as a way back in if the identity provider breaks.
   */
  setSsoOnly: sessionProcedure.input(z.object({ required: z.boolean() })).mutation(async ({ ctx, input }) => {
    const { org } = await requireMembership(ctx.user.id, "manage_sso");
    if (input.required && !(canRequireSso(org) && isWorkosConfigured())) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Verify your domain and finish SAML setup before requiring single sign-on." });
    }
    await setTeamSsoOnly(org.id, input.required);
    return { required: input.required };
  }),

  /** App admins: every team, for the Admin page, and linking a team to its WorkOS organisation. */
  adminList: adminProcedure.query(async () => {
    const db = await requireDb();
    const rows = await tolerateMissingSchema(
      "teams",
      () =>
        db
          .select({ org: organizations, ownerEmail: users.email, members: sql<string>`(SELECT COUNT(*) FROM organizationMembers m WHERE m.orgId = ${organizations.id})` })
          .from(organizations)
          .leftJoin(users, eq(users.id, organizations.ownerId))
          .orderBy(desc(organizations.createdAt))
          .limit(200),
      null as Array<{ org: Organization; ownerEmail: string | null; members: string }> | null,
    );
    return {
      available: rows !== null,
      billingConfigured: teamBilling() !== null,
      workos: describeWorkosConfig(),
      teams: (rows ?? []).map(({ org, ownerEmail, members }) => ({
        id: org.id,
        name: org.name,
        ownerEmail,
        members: Number(members),
        seats: org.seats,
        status: org.subscriptionStatus,
        verifiedDomain: org.verifiedDomain,
        workosOrganizationId: org.workosOrganizationId,
      })),
    };
  }),

  adminLinkWorkos: adminProcedure.input(z.object({ orgId: z.number().int().positive(), workosOrganizationId: z.string().regex(/^org_[A-Za-z0-9]+$/).nullable() })).mutation(async ({ input }) => {
    const db = await requireDb();
    try {
      await db.update(organizations).set({ workosOrganizationId: input.workosOrganizationId }).where(eq(organizations.id, input.orgId));
    } catch {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "That WorkOS organisation is already linked to another team." });
    }
    return { linked: Boolean(input.workosOrganizationId) };
  }),
});

async function usageByUser(userIds: number[]) {
  const result = new Map<number, { minutes: number; generations: number; recordings: number }>();
  if (!userIds.length) return result;
  const db = await requireDb();
  const period = usagePeriod();
  const rows = await tolerateMissingSchema(
    "usage",
    () =>
      db
        .select({ userId: usageEvents.userId, kind: usageEvents.kind, total: sql<string>`COALESCE(SUM(${usageEvents.units}), 0)` })
        .from(usageEvents)
        .where(and(inArray(usageEvents.userId, userIds), eq(usageEvents.period, period)))
        .groupBy(usageEvents.userId, usageEvents.kind),
    [] as Array<{ userId: number; kind: string; total: string }>,
  );
  const monthStart = new Date(`${period}-01T00:00:00Z`);
  const recordingRows = await db
    .select({ userId: recordings.userId, count: sql<string>`COUNT(*)` })
    .from(recordings)
    .where(and(inArray(recordings.userId, userIds), eq(recordings.isDeleted, 0), sql`${recordings.createdAt} >= ${monthStart}`))
    .groupBy(recordings.userId);
  for (const id of userIds) result.set(id, { minutes: 0, generations: 0, recordings: 0 });
  for (const row of rows) {
    const entry = result.get(row.userId)!;
    if (row.kind === "transcription") entry.minutes = Math.round(Number(row.total) / 60);
    else entry.generations = Number(row.total);
  }
  for (const row of recordingRows) result.get(row.userId)!.recordings = Number(row.count);
  return result;
}

// ---------------------------------------------------------- account data

/**
 * Account deletion: an owner's team is deleted with them (its subscription
 * cancelled first; a Stripe failure stops the deletion), anyone else just
 * leaves, taking their courses out of the library. Invitations to their
 * address are removed.
 */
export async function deleteOrgDataForUser(userId: number, email: string) {
  const membership = await getMembership(userId);
  if (membership?.role === "owner") await deleteOrganization(membership.org);
  else if (membership) await removeMemberRows(membership.org.id, userId);
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema("teams", () => db.delete(organizationInvites).where(eq(organizationInvites.email, email.toLowerCase())), undefined);
}

export async function exportOrgDataForUser(userId: number) {
  const membership = await getMembership(userId);
  if (!membership) return { team: null };
  const db = await getDb();
  const shared = db
    ? await tolerateMissingSchema(
        "teams",
        () => db.select({ courseId: organizationCourses.courseId, sharedAt: organizationCourses.createdAt }).from(organizationCourses).where(and(eq(organizationCourses.orgId, membership.org.id), eq(organizationCourses.sharedBy, userId))),
        [] as Array<{ courseId: number; sharedAt: Date }>,
      )
    : [];
  return { team: { name: membership.org.name, role: membership.role, coursesInLibrary: shared } };
}

export { type TeamSubscriptionState };

/**
 * Teams (F3): who may do what in an organisation, and how seats are counted.
 * Pure rules shared by the server (which enforces them) and the team console
 * (which only hides what the server would refuse).
 */

export type OrgRole = "owner" | "admin" | "member";
export const ORG_ROLES: OrgRole[] = ["owner", "admin", "member"];
export const INVITABLE_ROLES = ["admin", "member"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const ORG_ROLE_LABELS: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export type OrgAction =
  | "view_library"
  | "share_course"
  | "invite"
  | "remove_member"
  | "remove_admin"
  | "change_role"
  | "view_usage"
  | "rename"
  | "manage_domain"
  | "manage_billing"
  | "manage_sso"
  | "delete_team";

const ALLOWED: Record<OrgRole, ReadonlySet<OrgAction>> = {
  owner: new Set<OrgAction>(["view_library", "share_course", "invite", "remove_member", "remove_admin", "change_role", "view_usage", "rename", "manage_domain", "manage_billing", "manage_sso", "delete_team"]),
  admin: new Set<OrgAction>(["view_library", "share_course", "invite", "remove_member", "view_usage", "rename"]),
  member: new Set<OrgAction>(["view_library", "share_course"]),
};

export function orgCan(role: OrgRole | null | undefined, action: OrgAction) {
  return !!role && ALLOWED[role].has(action);
}

/** Admins can invite members and other admins; only the owner hands out admin by changing a role. */
export function canInviteAs(role: OrgRole | null | undefined, invitedRole: InvitableRole) {
  if (!orgCan(role, "invite")) return false;
  return invitedRole === "member" || role === "owner" || role === "admin";
}

/** Whether `actor` may remove `target` from the team. Nobody removes the owner; the owner transfers ownership or deletes the team. */
export function canRemove(actor: OrgRole | null | undefined, target: OrgRole) {
  if (target === "owner") return false;
  if (target === "admin") return orgCan(actor, "remove_admin");
  return orgCan(actor, "remove_member");
}

export type SeatInput = {
  /** Team billing (Stripe with STRIPE_PRICE_TEAM) is configured. Without it seats are not limited. */
  billingConfigured: boolean;
  subscriptionActive: boolean;
  paidSeats: number;
  members: number;
  pendingInvites: number;
};

/** Seats in use count members and pending invites, since an invite holds a seat until it is accepted or revoked. */
export function seatSummary(input: SeatInput) {
  const used = input.members + input.pendingInvites;
  if (!input.billingConfigured) return { limited: false as const, used, total: null, available: null };
  // Without an active subscription only the owner's own seat exists.
  const total = input.subscriptionActive ? Math.max(1, input.paidSeats) : 1;
  return { limited: true as const, used, total, available: Math.max(0, total - used) };
}

export function canAddSeatHolder(input: SeatInput, adding = 1) {
  const summary = seatSummary(input);
  if (!summary.limited) return { ok: true as const };
  if (summary.used + adding <= summary.total) return { ok: true as const };
  return {
    ok: false as const,
    reason: input.subscriptionActive
      ? `All ${summary.total} seats are taken. Add seats in the team console, or remove someone first.`
      : "Start the team plan to add people. Each person needs a seat.",
  };
}

/** Free email providers can never be claimed as a team's domain. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net", "mail.com", "zoho.com", "yandex.com", "yandex.ru", "qq.com", "163.com", "126.com",
  "hey.com", "fastmail.com", "tutanota.com", "duck.com",
]);

/** A lower-case domain name, or null when it is not one a team could own. */
export function normalizeTeamDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  if (domain.length < 4 || domain.length > 253) return null;
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return null;
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

export function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/** The TXT record that proves a team controls a domain. */
export function domainVerificationRecord(token: string) {
  return `studyscribe-verification=${token}`;
}

/** Whether any TXT string at the domain matches (TXT values can be split into chunks). */
export function hasVerificationRecord(records: string[][], token: string) {
  const expected = domainVerificationRecord(token);
  return records.some((chunks) => chunks.join("").trim() === expected);
}

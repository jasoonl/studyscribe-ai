/**
 * Share roles (D3). Shared between the server, which enforces them, and the
 * client, which labels them. "owner" is never stored on a share; it is what
 * the recording's own user gets.
 */
export const SHARE_ROLES = ["view", "comment", "edit"] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];
export type AccessRole = ShareRole | "owner";

const RANK: Record<AccessRole, number> = { view: 1, comment: 2, edit: 3, owner: 4 };

export const SHARE_ROLE_LABELS: Record<ShareRole, { label: string; hint: string }> = {
  view: { label: "Can view", hint: "Listen, read the transcript and study materials" },
  comment: { label: "Can comment", hint: "Also highlight and comment on the transcript" },
  edit: { label: "Can edit", hint: "Also correct the transcript and rename speakers" },
};

export function isShareRole(value: unknown): value is ShareRole {
  return typeof value === "string" && (SHARE_ROLES as readonly string[]).includes(value);
}

/** True when `role` includes everything `needed` allows. */
export function roleAllows(role: AccessRole | null | undefined, needed: AccessRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[needed];
}

/** The most capable of several grants (a direct share and group shares can overlap). */
export function strongestRole<T extends AccessRole>(roles: Array<T | null | undefined>): T | null {
  let best: T | null = null;
  for (const role of roles) {
    if (!role) continue;
    if (!best || RANK[role] > RANK[best]) best = role;
  }
  return best;
}

/** Comments and highlights are visible to the owner and to comment/edit shares, not view-only ones. */
export function canSeeAnnotations(role: AccessRole | null | undefined) {
  return roleAllows(role, "comment");
}

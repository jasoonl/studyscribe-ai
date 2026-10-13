export type PlanId = "free" | "basic" | "pro" | "max" | "team";

export const PLAN_IDS = ["free", "basic", "pro", "max"] as const satisfies readonly PlanId[];
export const PAID_PLAN_IDS = ["basic", "pro", "max"] as const satisfies readonly PlanId[];
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export type Plan = {
  id: PlanId;
  name: string;
  priceMonthlyUsd: number;
  tagline: string;
  /** Minutes of audio that can be transcribed each calendar month (UTC). */
  transcriptionMinutesPerMonth: number;
  /** AI generations each calendar month: a set of notes, flashcards, a quiz, a guide, a draft, a translation or a tutor answer counts as one. */
  aiGenerationsPerMonth: number;
  highlight?: boolean;
  /**
   * Whether the plan can be bought. This is the default for a server without
   * billing: paid plans say "Coming soon". The server turns it on for paid plans
   * when Stripe is configured (see `withAvailability`), so never read it from
   * this constant in the UI; use the `billing.plans` query.
   */
  purchasable: boolean;
};

/*
 * ---------------------------------------------------------------------------
 * PROPOSED allowances. These are defaults chosen for launch, not final
 * numbers: change them here and the Pricing page, Billing page, usage meters
 * and server-side limits all follow. Free is sized so a new student can record
 * two full lectures and try every study tool on them.
 *
 * Rough cost check at the time of writing (verify against current provider
 * pricing before launch): pre-recorded transcription with speaker labels is
 * well under $0.01 per minute, and one generation is one chat-completion call
 * on a transcript, so each paid tier keeps a margin at full use.
 * ---------------------------------------------------------------------------
 */
export const PLANS: Plan[] = [
  { id: "free", name: "Free", priceMonthlyUsd: 0, tagline: "Try every feature on a couple of lectures.", transcriptionMinutesPerMonth: 120, aiGenerationsPerMonth: 60, purchasable: true },
  { id: "basic", name: "Basic", priceMonthlyUsd: 5, tagline: "For a regular class schedule.", transcriptionMinutesPerMonth: 600, aiGenerationsPerMonth: 300, purchasable: false },
  { id: "pro", name: "Pro", priceMonthlyUsd: 20, tagline: "For full course loads and weekly meetings.", transcriptionMinutesPerMonth: 1800, aiGenerationsPerMonth: 1500, highlight: true, purchasable: false },
  { id: "max", name: "Max", priceMonthlyUsd: 50, tagline: "The largest allowance, for heavy use.", transcriptionMinutesPerMonth: 6000, aiGenerationsPerMonth: 5000, purchasable: false },
];

export const PLAN_FEATURES = [
  "Transcripts with speaker labels",
  "Flashcards, quizzes and study guides",
  "AI tutor and email drafts",
  "Export to Quizlet, Anki and Notion",
];

/**
 * Team plan (F3): paid per seat by a team's owner, and gives every member
 * this allowance (each member has their own monthly allowance). PROPOSED,
 * like the others: the per-seat price is set by the Stripe price in
 * STRIPE_PRICE_TEAM, and `priceMonthlyUsd` here is only what the pages say.
 * Not in PLANS, because it is bought for a team, not by one person.
 */
export const TEAM_PLAN: Plan = {
  id: "team",
  name: "Team",
  priceMonthlyUsd: 12,
  tagline: "For study groups, labs, classes and teams, paid per seat.",
  transcriptionMinutesPerMonth: 1800,
  aiGenerationsPerMonth: 1500,
  purchasable: false,
};

export function getPlan(id: string | null | undefined): Plan {
  if (id === "team") return TEAM_PLAN;
  return PLANS.find((plan) => plan.id === id) ?? PLANS[0];
}

/** The plan with the larger allowance: a member's own plan, or the one their team pays for. */
export function betterPlan(a: Plan, b: Plan): Plan {
  const score = (plan: Plan) => plan.transcriptionMinutesPerMonth * 10_000 + plan.aiGenerationsPerMonth;
  return score(b) > score(a) ? b : a;
}

export function isPaidPlanId(id: string): id is PaidPlanId {
  return (PAID_PLAN_IDS as readonly string[]).includes(id);
}

/** The plans as the site should offer them: paid plans are purchasable only when billing is set up. */
export function withAvailability(billingEnabled: boolean): Plan[] {
  return PLANS.map((plan) => ({ ...plan, purchasable: plan.id === "free" || billingEnabled }));
}

export function formatPlanPrice(plan: Plan) {
  return plan.priceMonthlyUsd === 0 ? "$0" : `$${plan.priceMonthlyUsd}`;
}

export function formatMinutes(minutes: number) {
  if (minutes >= 120 && minutes % 60 === 0) return `${(minutes / 60).toLocaleString("en-US")} hours`;
  return `${minutes.toLocaleString("en-US")} minutes`;
}

/** "2 hours of transcription"; shown under an "Each month" label. */
export function describeAllowance(plan: Plan) {
  return `${formatMinutes(plan.transcriptionMinutesPerMonth)} of transcription`;
}

/** "60 AI generations"; shown under an "Each month" label. */
export function describeGenerations(plan: Plan) {
  return `${plan.aiGenerationsPerMonth.toLocaleString("en-US")} AI generations`;
}

export type PlanId = "free" | "basic" | "pro" | "max";

export type Plan = {
  id: PlanId;
  name: string;
  priceMonthlyUsd: number;
  tagline: string;
  /** Recordings allowed per month. null until the limits are decided; the UI then says they are announced at launch. */
  recordingsPerMonth: number | null;
  highlight?: boolean;
  /** False until billing is wired up; the pricing UI shows "Coming soon" instead of a purchase button. */
  purchasable: boolean;
};

export const PLANS: Plan[] = [
  { id: "free", name: "Free", priceMonthlyUsd: 0, tagline: "Try StudyScribe on a few lectures.", recordingsPerMonth: null, purchasable: true },
  { id: "basic", name: "Basic", priceMonthlyUsd: 5, tagline: "For a regular class schedule.", recordingsPerMonth: null, purchasable: false },
  { id: "pro", name: "Pro", priceMonthlyUsd: 20, tagline: "For full course loads and weekly meetings.", recordingsPerMonth: null, highlight: true, purchasable: false },
  { id: "max", name: "Max", priceMonthlyUsd: 50, tagline: "The largest recording allowance.", recordingsPerMonth: null, purchasable: false },
];

export const PLAN_FEATURES = [
  "Transcripts with speaker labels",
  "Flashcards, quizzes and study guides",
  "AI tutor and email drafts",
  "Export to Quizlet, Anki and Notion",
];

export function formatPlanPrice(plan: Plan) {
  return plan.priceMonthlyUsd === 0 ? "$0" : `$${plan.priceMonthlyUsd}`;
}

export function describeAllowance(plan: Plan) {
  return plan.recordingsPerMonth === null ? "Recording allowance announced at launch" : `${plan.recordingsPerMonth} recordings per month`;
}

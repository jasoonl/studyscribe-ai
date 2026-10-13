import { TRPCClientError } from "@trpc/client";
import { toast } from "sonner";

type UsageLimitData = { kind: "transcription" | "ai_generation"; upgradeAvailable: boolean } | null | undefined;

export function usageLimitOf(error: unknown): UsageLimitData {
  if (!(error instanceof TRPCClientError)) return null;
  return (error.data as { usageLimit?: UsageLimitData } | undefined)?.usageLimit ?? null;
}

/**
 * When a mutation is refused because the month's allowance is used up, the
 * page shows the server's message as usual; this adds one quiet follow-up
 * with a way to Billing, only when paid plans can actually be bought.
 */
export function offerUpgradeOnUsageLimit(error: unknown) {
  const limit = usageLimitOf(error);
  if (!limit?.upgradeAvailable || typeof window === "undefined") return;
  toast("Need more this month?", {
    id: "usage-limit",
    description: limit.kind === "transcription" ? "Paid plans include more transcription time." : "Paid plans include more AI generations.",
    action: { label: "See plans", onClick: () => window.location.assign("/billing") },
  });
}

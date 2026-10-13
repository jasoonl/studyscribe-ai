import { cn } from "@/lib/utils";
import { bestYearlySavingsPercent, type BillingInterval } from "@shared/plans";

/**
 * Monthly / yearly switch for Pricing and Billing. Shown only when the server
 * has yearly Stripe prices (`billing.plans.yearlyEnabled`).
 */
export function BillingIntervalToggle({ value, onChange, className, inverted = false }: { value: BillingInterval; onChange: (value: BillingInterval) => void; className?: string; inverted?: boolean }) {
  const saving = bestYearlySavingsPercent();
  return (
    <div role="group" aria-label="Billing period" className={cn("inline-flex rounded-lg border border-border bg-muted p-0.5", className)}>
      {(["month", "year"] as const).map(option => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === option ? "bg-background text-foreground shadow-sm" : inverted ? "text-foreground/70 hover:text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option === "month" ? "Monthly" : saving > 0 ? `Yearly, save ${saving}%` : "Yearly"}
        </button>
      ))}
    </div>
  );
}

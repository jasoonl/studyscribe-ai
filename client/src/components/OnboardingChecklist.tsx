import { useState } from "react";
import { Link } from "wouter";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CourseDialog } from "@/components/CourseDialog";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "studyscribe_setup_checklist_hidden";

function readHidden(userId: number) {
  try {
    return localStorage.getItem(`${DISMISS_KEY}:${userId}`) === "1";
  } catch {
    return false;
  }
}

/**
 * "Get set up" on the library (F5): five first steps, ticked off from real
 * data. Follows the welcome tour (OnboardingModal); hidden once every step is
 * done, or when the person hides it (remembered in this browser).
 */
export function OnboardingChecklist({ userId, onOpenRecorder }: { userId: number; onOpenRecorder: () => void }) {
  const { data } = trpc.onboarding.checklist.useQuery(undefined, { staleTime: 30_000 });
  const [hidden, setHidden] = useState(() => readHidden(userId));
  const [creatingCourse, setCreatingCourse] = useState(false);
  const utils = trpc.useUtils();

  if (hidden || !data || data.done === data.total) return null;

  const hide = () => {
    try {
      localStorage.setItem(`${DISMISS_KEY}:${userId}`, "1");
    } catch {
      // Private mode: it stays hidden for this visit only.
    }
    setHidden(true);
  };

  return (
    <section aria-labelledby="setup-heading" className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="setup-heading" className="text-base font-semibold">Get set up</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data.done} of {data.total} done
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={hide} className="-mr-2 -mt-1 text-muted-foreground">
          Hide
        </Button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${(data.done / data.total) * 100}%` }} />
      </div>
      <ol className="mt-4 divide-y divide-border">
        {data.steps.map((step) => (
          <li key={step.id} className="flex items-center gap-3 py-3 first:pt-1 last:pb-0">
            <span
              className={cn(
                "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                step.done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
              )}
            >
              {step.done && <Check className="h-3 w-3" strokeWidth={3} />}
              <span className="sr-only">{step.done ? "Done:" : "To do:"}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", step.done && "text-muted-foreground line-through decoration-muted-foreground/50")}>{step.title}</p>
              {!step.done && <p className="text-xs text-muted-foreground">{step.detail}</p>}
            </div>
            {!step.done &&
              (step.action.kind === "link" ? (
                <Button variant="outline" size="sm" asChild className="shrink-0">
                  <Link href={step.action.href}>{step.action.label}</Link>
                </Button>
              ) : step.action.kind === "recorder" ? (
                <Button variant="outline" size="sm" className="shrink-0" onClick={onOpenRecorder}>
                  {step.action.label}
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => setCreatingCourse(true)}>
                  {step.action.label}
                </Button>
              ))}
          </li>
        ))}
      </ol>
      <CourseDialog
        open={creatingCourse}
        onOpenChange={(open) => {
          setCreatingCourse(open);
          if (!open) void utils.onboarding.checklist.invalidate();
        }}
      />
    </section>
  );
}

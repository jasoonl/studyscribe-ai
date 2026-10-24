import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { navigate } from "wouter/use-browser-location";
import { t } from "@/i18n";
import { offerUpgradeOnUsageLimit } from "@/lib/usageLimit";
import { originKey, practiceErrorKind, practicePath, type PracticeErrorKind } from "@/lib/practiceModel";
import { practiceApi, type PracticeOrigin } from "@/lib/practiceTypes";

export type MissedJob = {
  key: string;
  step: "preparing" | "adding" | "done" | "failed";
  sessionId: number | null;
  /** The questions that were missed are ready but the new similar ones could not be added. */
  similarFailed: boolean;
  error: { kind: PracticeErrorKind; message: string } | null;
};

type Value = {
  job: MissedJob | null;
  /** Some set is being prepared; starting another would be ignored, so buttons disable themselves. */
  busy: boolean;
  start: (origin: PracticeOrigin, options: { similar: boolean }) => void;
  dismiss: () => void;
  /** A button for this origin is on screen; it opens the session itself when the work ends. */
  attach: (key: string) => () => void;
};

const Context = createContext<Value | null>(null);

/**
 * "Practice what I missed" takes two requests (copy the missed questions, then write similar
 * ones). It runs here, above the router, so leaving the results page does not cancel it: if the
 * button is still on screen it opens the new session, otherwise a toast offers to.
 */
export function PracticeWorkProvider({ children }: { children: ReactNode }) {
  const missedFrom = practiceApi.practice.missedFrom.useMutation();
  const addSimilar = practiceApi.practice.addSimilar.useMutation();
  const [job, setJob] = useState<MissedJob | null>(null);
  const running = useRef(false);
  const attached = useRef(new Map<string, number>());
  // Mutation objects change identity on every render; the latest ones are read through refs.
  const missedFromRef = useRef(missedFrom.mutateAsync);
  missedFromRef.current = missedFrom.mutateAsync;
  const addSimilarRef = useRef(addSimilar.mutateAsync);
  addSimilarRef.current = addSimilar.mutateAsync;

  const finish = useCallback((key: string, sessionId: number, similarFailed: boolean) => {
    if ((attached.current.get(key) ?? 0) > 0) {
      setJob({ key, step: "done", sessionId, similarFailed, error: null });
    } else {
      setJob(null);
      toast.success(t("mistakes.practiceReady"), {
        id: "practice-missed-ready",
        action: { label: t("mistakes.openPractice"), onClick: () => navigate(practicePath(sessionId)) },
      });
    }
  }, []);

  const start = useCallback(
    (origin: PracticeOrigin, options: { similar: boolean }) => {
      if (running.current) return;
      running.current = true;
      const key = originKey(origin);
      setJob({ key, step: "preparing", sessionId: null, similarFailed: false, error: null });
      void (async () => {
        let sessionId: number | null = null;
        try {
          const created = await missedFromRef.current({ origin, similar: options.similar });
          sessionId = created.sessionId;
          if (options.similar) {
            setJob({ key, step: "adding", sessionId, similarFailed: false, error: null });
            try {
              await addSimilarRef.current({ sessionId });
            } catch (error) {
              // The missed questions alone are already a usable practice set.
              if (practiceErrorKind(error) === "usageLimit") offerUpgradeOnUsageLimit(error);
              finish(key, sessionId, true);
              return;
            }
          }
          finish(key, sessionId, false);
        } catch (error) {
          const kind = practiceErrorKind(error);
          if (kind === "usageLimit") offerUpgradeOnUsageLimit(error);
          setJob({ key, step: "failed", sessionId, similarFailed: false, error: { kind, message: error instanceof Error ? error.message : "" } });
        } finally {
          running.current = false;
        }
      })();
    },
    [finish],
  );

  const dismiss = useCallback(() => setJob(current => (current && current.step !== "preparing" && current.step !== "adding" ? null : current)), []);

  const attach = useCallback((key: string) => {
    attached.current.set(key, (attached.current.get(key) ?? 0) + 1);
    return () => {
      const left = (attached.current.get(key) ?? 1) - 1;
      if (left <= 0) {
        attached.current.delete(key);
        // A failed job belongs to the button that started it; it does not come back with an old error later.
        setJob(current => (current && current.key === key && current.step === "failed" ? null : current));
      } else attached.current.set(key, left);
    };
  }, []);

  const busy = job?.step === "preparing" || job?.step === "adding";
  const value = useMemo<Value>(() => ({ job, busy, start, dismiss, attach }), [job, busy, start, dismiss, attach]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePracticeWork(): Value {
  const value = useContext(Context);
  if (!value) throw new Error("usePracticeWork needs PracticeWorkProvider");
  return value;
}

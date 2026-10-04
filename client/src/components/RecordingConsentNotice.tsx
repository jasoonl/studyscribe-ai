import { ShieldCheck } from "lucide-react";

/** Shown wherever someone starts adding audio: recording laws vary and the user is responsible for consent. */
export default function RecordingConsentNotice() {
  return (
    <div role="note" className="mb-8 flex items-start gap-3 rounded-2xl border border-primary/20 bg-brand-mist/70 p-4 text-sm">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <p className="text-foreground/80">
        <strong className="text-foreground">Only record with permission.</strong> Many places require everyone's consent to record a conversation. Make sure you have permission from the people you record, and only add audio, video or links you have the right to use. See our{" "}
        <a href="/terms" target="_blank" rel="noopener" className="font-medium text-primary underline">Terms</a>.
      </p>
    </div>
  );
}

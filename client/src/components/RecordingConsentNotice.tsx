import { ShieldCheck } from "lucide-react";
import { Trans, useI18n } from "@/i18n";

/** Shown wherever someone starts adding audio: recording laws vary and the user is responsible for consent. */
export default function RecordingConsentNotice() {
  useI18n();
  return (
    <div role="note" className="mb-8 flex items-start gap-3 rounded-2xl border border-primary/20 bg-brand-mist/70 p-4 text-sm">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <p className="text-foreground/80">
        <Trans
          k="record.consent"
          parts={{
            strong: text => <strong className="text-foreground">{text}</strong>,
            terms: text => <a href="/terms" target="_blank" rel="noopener" className="font-medium text-primary underline">{text}</a>,
          }}
        />
      </p>
    </div>
  );
}

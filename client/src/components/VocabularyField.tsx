import { useState } from "react";
import { Link } from "wouter";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** The typed list as sent to the server, which trims, de-duplicates and caps it. */
export function vocabularyForRequest(value: string): string[] | undefined {
  const terms = value.split(/[\n,;]+/).map(term => term.trim()).filter(Boolean);
  return terms.length ? terms : undefined;
}

/**
 * Optional extra words for one recording (B2): names and terms the
 * transcription might otherwise mishear. Starts closed so it costs the
 * upload flow nothing when it is not needed.
 */
export function VocabularyField({ value, onChange, id }: { value: string; onChange: (value: string) => void; id: string }) {
  const [open, setOpen] = useState(value.trim().length > 0);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-left text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Add names or terms to listen for
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Names and terms to listen for</Label>
      <Textarea
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={"Prof. Okafor\nKrebs cycle\nATP synthase"}
        rows={3}
        className="resize-y text-sm"
      />
      <p className="text-xs text-muted-foreground">
        One per line, up to six words each. Used with your standing list from{" "}
        <Link href="/settings" className="text-primary underline-offset-4 hover:underline">Settings</Link>.
      </p>
    </div>
  );
}

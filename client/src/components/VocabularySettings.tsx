import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

/** The standing custom vocabulary sent with every transcription (B2). */
export function VocabularySettings() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.vocabulary.get.useQuery();
  const [value, setValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const save = trpc.vocabulary.save.useMutation({
    onSuccess: result => {
      setValue(result.terms.join("\n"));
      setDirty(false);
      void utils.vocabulary.get.invalidate();
      toast.success(
        result.terms.length
          ? `Saved ${result.terms.length} term${result.terms.length === 1 ? "" : "s"}`
          : "List cleared"
      );
    },
    onError: error => toast.error(error.message || "Could not save the list"),
  });

  useEffect(() => {
    if (data && !dirty) setValue(data.terms.join("\n"));
  }, [data, dirty]);

  const count = value
    .split(/[\n,;]+/)
    .map(term => term.trim())
    .filter(Boolean).length;

  return (
    <Card className="p-6">
      <div>
        <Label htmlFor="vocabulary" className="text-lg font-semibold">
          Names and terms to listen for
        </Label>
        <p className="mt-1 text-sm text-muted-foreground">
          Lecturers' names, course jargon and anything else transcription tends
          to mishear. Sent with every recording you add; you can add more for a
          single upload when you make it. Applies to new transcriptions, not
          ones already done.
        </p>
      </div>
      <div>
        <Textarea
          id="vocabulary"
          value={value}
          disabled={isLoading}
          onChange={event => {
            setValue(event.target.value);
            setDirty(true);
          }}
          placeholder={"Prof. Okafor\nKrebs cycle\nATP synthase"}
          rows={6}
          className="resize-y text-sm"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            One per line, up to six words each.{" "}
            <span className="tabular-nums">{count}</span> of {data?.max ?? 200}.
          </p>
          <Button
            onClick={() => save.mutate({ terms: value })}
            disabled={!dirty || save.isPending}
            className="gap-2"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save list
          </Button>
        </div>
      </div>
    </Card>
  );
}

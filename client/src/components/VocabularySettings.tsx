import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useI18n, t, tn } from "@/i18n";

/** The standing custom vocabulary sent with every transcription (B2). */
export function VocabularySettings() {
  const { formatNumber } = useI18n();
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
          ? tn("settingsCards.vocab.saved", result.terms.length)
          : t("settingsCards.vocab.cleared")
      );
    },
    onError: error => toast.error(error.message || t("settingsCards.vocab.saveFailed")),
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
          {t("settingsCards.vocab.title")}
        </Label>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settingsCards.vocab.help")}
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
          placeholder={t("settingsCards.vocab.placeholder")}
          rows={6}
          className="resize-y text-sm"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {t("settingsCards.vocab.count", { count: formatNumber(count), max: formatNumber(data?.max ?? 200) })}
          </p>
          <Button
            onClick={() => save.mutate({ terms: value })}
            disabled={!dirty || save.isPending}
            className="gap-2"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("settingsCards.vocab.save")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

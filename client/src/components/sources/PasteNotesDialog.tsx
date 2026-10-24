import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { MAX_SOURCE_TEXT_BYTES } from "@shared/const";

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
const byteLength = (text: string) => (encoder ? encoder.encode(text).length : text.length);

/** Pasted notes become a .txt file and use the normal upload, so they are limited like one. */
export function PasteNotesDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (title: string, text: string) => void }) {
  const { t, formatNumber } = useI18n();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    if (open) {
      setTitle("");
      setText("");
    }
  }, [open]);

  const tooLong = byteLength(text) > MAX_SOURCE_TEXT_BYTES;
  const canSave = text.trim().length > 0 && !tooLong;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form
          className="space-y-5"
          onSubmit={event => {
            event.preventDefault();
            if (!canSave) return;
            onSubmit(title.trim() || t("sources.paste.defaultTitle"), text);
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("sources.paste.title")}</DialogTitle>
            <DialogDescription>{t("sources.paste.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="paste-title">{t("sources.paste.nameLabel")}</Label>
            <Input id="paste-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} placeholder={t("sources.paste.namePlaceholder")} autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paste-text">{t("sources.paste.textLabel")}</Label>
            <Textarea id="paste-text" value={text} onChange={event => setText(event.target.value)} rows={10} className="max-h-[50dvh] text-base sm:text-sm" aria-invalid={tooLong} aria-describedby="paste-count" />
            <p id="paste-count" className={tooLong ? "text-sm text-destructive" : "text-xs text-muted-foreground"} role={tooLong ? "alert" : undefined}>
              {tooLong ? t("sources.paste.tooLong") : t("sources.paste.count", { count: formatNumber(text.length) })}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("sources.paste.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {t("sources.paste.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

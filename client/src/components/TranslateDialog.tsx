import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Copy, Languages, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatTranscriptTimestamp } from "@/lib/transcriptSegments";
import { trpc } from "@/lib/trpc";
import { TRANSCRIPTION_LANGUAGES } from "@shared/languages";

export type TranslatableKind = "transcript" | "guide" | "note";

const LANGUAGES = TRANSCRIPTION_LANGUAGES.map((language) => ({ code: language.code, label: language.label.replace(/ \(.*\)/, "") }));

type Chunk = {
  index: number;
  lines: Array<{ start: number | null; speaker: string | null }> | null;
  translatedLines: string[] | null;
  translation: string | null;
};

const isDone = (chunk: Chunk) => chunk.translatedLines !== null || chunk.translation !== null;

function chunkAsText(chunk: Chunk) {
  if (chunk.translatedLines && chunk.lines) {
    return chunk.translatedLines
      .map((line, i) => {
        const meta = chunk.lines![i];
        const time = meta?.start !== null && meta?.start !== undefined ? `[${formatTranscriptTimestamp(meta.start)}] ` : "";
        return `${time}${meta?.speaker ? `${meta.speaker}: ` : ""}${line}`;
      })
      .join("\n");
  }
  return chunk.translation ?? "";
}

/** A "Translate" button with the language list; opens the translation for the chosen language. */
export function TranslateMenu({ kind, id, label = "Translate", size = "sm", variant = "ghost" }: { kind: TranslatableKind; id: number; label?: string; size?: "sm" | "default"; variant?: "ghost" | "outline" }) {
  const [language, setLanguage] = useState<{ code: string; label: string } | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} size={size} className="gap-2">
            <Languages className="h-4 w-4" />
            {label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
          {LANGUAGES.map((option) => (
            <DropdownMenuItem key={option.code} onSelect={() => setLanguage(option)}>
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {language && <TranslateDialog kind={kind} id={id} language={language} onClose={() => setLanguage(null)} />}
    </>
  );
}

/**
 * Translates a transcript, study guide or note part by part (F7). Parts
 * already translated come back from storage at once; the rest are translated
 * one request at a time and appear as they finish. Closing stops it, and
 * opening it again continues where it left off.
 */
export function TranslateDialog({ kind, id, language, onClose }: { kind: TranslatableKind; id: number; language: { code: string; label: string }; onClose: () => void }) {
  const query = trpc.translations.get.useQuery({ kind, id, language: language.code }, { refetchOnWindowFocus: false, retry: false });
  const translate = trpc.translations.translateChunk.useMutation();
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [failedAt, setFailedAt] = useState<{ index: number; message: string } | null>(null);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (query.data && chunks === null) setChunks(query.data.chunks);
  }, [query.data, chunks]);

  const run = useCallback(
    async (start: Chunk[]) => {
      cancelled.current = false;
      setRunning(true);
      setFailedAt(null);
      for (const chunk of start) {
        if (cancelled.current) break;
        if (isDone(chunk)) continue;
        try {
          const result = await translate.mutateAsync({ kind, id, language: language.code, index: chunk.index });
          if (cancelled.current) break;
          setChunks((current) => current?.map((item) => (item.index === result.index ? result : item)) ?? null);
        } catch (error) {
          if (!cancelled.current) setFailedAt({ index: chunk.index, message: error instanceof Error ? error.message : "This part could not be translated." });
          break;
        }
      }
      setRunning(false);
    },
    [id, kind, language.code, translate],
  );

  // Start translating whatever is missing as soon as the parts are known.
  const started = useRef(false);
  useEffect(() => {
    if (!chunks || started.current) return;
    started.current = true;
    if (chunks.some((chunk) => !isDone(chunk))) void run(chunks);
  }, [chunks, run]);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const done = chunks?.filter(isDone).length ?? 0;
  const total = chunks?.length ?? 0;
  const close = () => {
    cancelled.current = true;
    onClose();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText((chunks ?? []).filter(isDone).map(chunkAsText).join("\n\n"));
      toast.success("Translation copied");
    } catch {
      toast.error("Copy failed. Select the text and copy it instead.");
    }
  };

  const title = query.data?.title ?? (kind === "transcript" ? "Transcript" : kind === "guide" ? "Study guide" : "Notes");

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="pr-6">
            {title} in {language.label}
          </DialogTitle>
          <DialogDescription>
            Machine translation, saved so it opens instantly next time.{" "}
            {total > 1 && (running ? `Translating part ${Math.min(done + 1, total)} of ${total}.` : done < total ? `${done} of ${total} parts translated.` : `All ${total} parts translated.`)}
          </DialogDescription>
        </DialogHeader>

        {total > 1 && (
          <div className="h-1.5 shrink-0 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Translation progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {query.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : query.error ? (
            <p className="text-sm text-destructive">{query.error.message}</p>
          ) : (
            <div className="space-y-4">
              {chunks?.filter(isDone).map((chunk) =>
                chunk.translatedLines && chunk.lines ? (
                  <ol key={chunk.index} className="space-y-2.5">
                    {chunk.translatedLines.map((line, i) => {
                      const meta = chunk.lines![i];
                      const showSpeaker = meta?.speaker && meta.speaker !== chunk.lines![i - 1]?.speaker;
                      return (
                        <li key={i} className="grid grid-cols-[3.5rem_1fr] gap-3 text-sm leading-relaxed">
                          <span className="pt-0.5 text-xs tabular-nums text-muted-foreground">{meta?.start !== null && meta?.start !== undefined ? formatTranscriptTimestamp(meta.start) : ""}</span>
                          <span>
                            {showSpeaker && <span className="mb-0.5 block text-xs font-medium text-muted-foreground">{meta!.speaker}</span>}
                            {line}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <div key={chunk.index} className="prose prose-sm max-w-none dark:prose-invert">
                    {kind === "transcript" ? <p className="whitespace-pre-wrap">{chunk.translation}</p> : <Markdown>{chunk.translation ?? ""}</Markdown>}
                  </div>
                ),
              )}
              {running && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {done === 0 ? "Translating the first part" : "Translating the next part"}
                </p>
              )}
              {failedAt && (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span>{failedAt.message}</span>
                  <Button size="sm" variant="outline" onClick={() => chunks && run(chunks)} className="shrink-0">
                    Try again
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-4">
          {running ? (
            <Button variant="ghost" onClick={() => (cancelled.current = true)}>
              Stop
            </Button>
          ) : chunks && done < total && !failedAt ? (
            <Button variant="ghost" onClick={() => run(chunks)}>
              Continue
            </Button>
          ) : null}
          <Button variant="outline" className="gap-2" onClick={copy} disabled={done === 0}>
            <Copy className="h-4 w-4" /> Copy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

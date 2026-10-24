import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CourseSelect, NO_COURSE, courseForRequest } from "@/components/CourseSelect";
import { Markdown } from "@/components/Markdown";
import { trpc } from "@/lib/trpc";
import { offerUpgradeOnUsageLimit } from "@/lib/usageLimit";
import { useI18n } from "@/i18n";
import { MAX_NOTE_BODY_CHARS, MAX_NOTE_TITLE_CHARS, applyOrganized, canReplaceAfterOrganize, type NoteOrganizeMode } from "@shared/notePages";

const AUTOSAVE_MS = 1200;
type Draft = { title: string; body: string; course: string };
type SaveState = "saved" | "dirty" | "saving" | "failed" | "conflict";
const draftKey = (noteId: number) => `studyscribe_note_draft:${noteId}`;

/** Best effort: sessionStorage can be missing or full. */
function keepDraft(noteId: number, value: Draft | null) {
  try {
    if (value) sessionStorage.setItem(draftKey(noteId), JSON.stringify(value));
    else sessionStorage.removeItem(draftKey(noteId));
  } catch { /* nothing to do */ }
}
function readDraft(noteId: number): Draft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(noteId));
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value.title === "string" && typeof value.body === "string" && typeof value.course === "string" ? value : null;
  } catch { return null; }
}

/** One standalone note: title, Markdown text with a preview, autosave, course, delete and the AI helper. */
export default function NoteEditor() {
  const { t, formatNumber } = useI18n();
  const [, params] = useRoute("/notes/:id");
  const [, navigate] = useLocation();
  const id = Number(params?.id);
  const validId = Number.isInteger(id) && id > 0;
  const utils = trpc.useUtils();
  const { data, isLoading, isError } = trpc.notePages.get.useQuery({ id }, { enabled: validId, retry: false, refetchOnWindowFocus: true });

  const [draft, setDraft] = useState<Draft>({ title: "", body: "", course: NO_COURSE });
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [showPreview, setShowPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [suggestion, setSuggestion] = useState<{ markdown: string; shortened: boolean; base: string } | null>(null);
  const [offeredDraft, setOfferedDraft] = useState<Draft | null>(null);
  const stamp = useRef<Date>(new Date(0));
  const organizeBase = useRef("");
  const saved = useRef<Draft>(draft);
  const latest = useRef<Draft>(draft);
  const inFlight = useRef<Promise<boolean> | null>(null);
  latest.current = draft;
  const conflictRef = useRef(false);

  const update = trpc.notePages.update.useMutation();

  /** Makes the server's version the draft and the base for the next save. */
  const adopt = useCallback((note: { title: string; body: string; courseId: number | null; updatedAt: Date }) => {
    const next = { title: note.title, body: note.body, course: note.courseId ? String(note.courseId) : NO_COURSE };
    saved.current = next;
    latest.current = next;
    stamp.current = note.updatedAt;
    setDraft(next);
    setSaveState("saved");
  }, []);

  useEffect(() => {
    if (!data) return;
    if (!loaded) {
      adopt(data);
      setLoaded(true);
      const kept = readDraft(id);
      if (kept && (kept.title !== data.title || kept.body !== data.body)) setOfferedDraft(kept);
      else keepDraft(id, null);
      return;
    }
    // A refetch (window focus) brings in a newer version only when there is nothing unsaved to lose.
    if (data.updatedAt.getTime() > stamp.current.getTime() && !inFlight.current && !isDirty(latest.current) && saveState === "saved") adopt(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const isDirty = (value: Draft) => value.title !== saved.current.title || value.body !== saved.current.body || value.course !== saved.current.course;

  /** Saves the latest text; resolves true when nothing is left unsaved. */
  const save = useCallback(async (): Promise<boolean> => {
    if (!validId) return true;
    if (conflictRef.current) return false;
    while (inFlight.current) await inFlight.current;
    const sending = latest.current;
    if (!isDirty(sending)) return true;
    setSaveState("saving");
    const run = update
      .mutateAsync({ id, title: sending.title, body: sending.body, courseId: courseForRequest(sending.course) ?? null, expectedUpdatedAt: stamp.current })
      .then(result => {
        saved.current = sending;
        stamp.current = result.savedAt;
        setSaveState(isDirty(latest.current) ? "dirty" : "saved");
        void utils.notePages.list.invalidate();
        return true;
      })
      .catch(error => {
        if (error?.data?.code === "CONFLICT") {
          conflictRef.current = true;
          setSaveState("conflict");
          return false;
        }
        setSaveState("failed");
        toast.error(error?.message || t("notes.saveFailed"));
        return false;
      })
      .finally(() => { inFlight.current = null; });
    inFlight.current = run;
    return run;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, validId]);

  const change = (patch: Partial<Draft>) => {
    setDraft(current => ({ ...current, ...patch }));
    setSaveState(current => (current === "saving" || current === "conflict" ? current : "dirty"));
  };

  // Debounced autosave.
  useEffect(() => {
    if (!loaded || saveState !== "dirty") return;
    const timer = window.setTimeout(() => { void save(); }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, loaded, saveState, save]);

  // Unsaved-changes guard: closing the tab warns; leaving the page inside the app saves what is left.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (loaded && isDirty(latest.current)) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (loaded && isDirty(latest.current)) {
        const unsaved = latest.current;
        void save().then(ok => { if (!ok) keepDraft(id, unsaved); });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, save]);

  const leave = async (event: React.MouseEvent) => {
    // Let the browser handle open-in-new-tab clicks.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (loaded && isDirty(latest.current) && !(await save()) && !window.confirm(t("notes.leaveConfirm"))) return;
    navigate("/notes");
  };

  const resolveConflict = async (action: "reload" | "overwrite") => {
    const fresh = await utils.notePages.get.fetch({ id });
    conflictRef.current = false;
    if (action === "reload") {
      keepDraft(id, latest.current); // the discarded text stays recoverable in this tab
      adopt(fresh);
      return;
    }
    stamp.current = fresh.updatedAt;
    setSaveState("dirty");
  };
  const copyMine = async () => {
    try {
      await navigator.clipboard.writeText(latest.current.body);
      toast.success(t("notes.conflict.copied"));
    } catch {
      toast.error(t("notes.conflict.copyFailed"));
    }
  };

  const remove = trpc.notePages.delete.useMutation({
    onSuccess: () => {
      saved.current = latest.current; // nothing left to save
      keepDraft(id, null);
      void utils.notePages.list.invalidate();
      toast.success(t("notes.deleted"));
      navigate("/notes");
    },
    onError: error => toast.error(error.message),
  });

  const organize = trpc.notePages.organize.useMutation({
    onSuccess: result => setSuggestion({ markdown: result.markdown, shortened: result.shortened, base: organizeBase.current }),
    onError: error => {
      toast.error(error.message || t("notes.ai.failed"));
      offerUpgradeOnUsageLimit(error);
    },
  });
  const runOrganize = async (mode: NoteOrganizeMode) => {
    toast.dismiss("note-save-first");
    if (conflictRef.current) return;
    if (isDirty(latest.current)) {
      toast(t("notes.ai.saveFirst"), { id: "note-save-first" });
      if (!(await save())) return;
    }
    organizeBase.current = latest.current.body;
    organize.mutate({ id, mode });
  };
  const applySuggestion = (action: "replace" | "append") => {
    if (!suggestion) return;
    // Text typed while the AI worked would be thrown away by Replace.
    if (action === "replace" && !canReplaceAfterOrganize(draft.body, suggestion.base)) return;
    const next = action === "replace" ? suggestion.markdown.trim() : `${draft.body.replace(/\s+$/, "")}\n\n${suggestion.markdown.trim()}`;
    if (next.length > MAX_NOTE_BODY_CHARS) { toast.error(t("notes.ai.tooLong")); return; }
    change({ body: applyOrganized(draft.body, suggestion.markdown, action) });
    setSuggestion(null);
  };

  const shell = (content: React.ReactNode) => (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-2" asChild>
            <Link href="/notes" onClick={leave}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("notes.back")}</Link>
          </Button>
        </div>
      </header>
      <main id="main-content" className="container max-w-3xl pb-20 pt-8" tabIndex={-1}>{content}</main>
    </div>
  );

  if (!validId || isError) return shell(<p role="alert" className="text-muted-foreground">{t("notes.notFound")}</p>);
  if (isLoading || !loaded) return shell(<div className="flex justify-center py-16" role="status" aria-label={t("common.loading")}><Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" /></div>);

  const status = { saved: t("notes.saved"), dirty: t("notes.unsaved"), saving: t("notes.saving"), failed: t("notes.saveFailed"), conflict: t("notes.conflict.title") }[saveState];
  const stale = suggestion !== null && !canReplaceAfterOrganize(draft.body, suggestion.base);

  return shell(
    <>
      <div className="space-y-5">
        {saveState === "conflict" && (
          <div role="alert" className="space-y-3 rounded-md border border-destructive/40 bg-card p-4">
            <p className="font-medium text-foreground">{t("notes.conflict.title")}</p>
            <p className="text-sm text-muted-foreground">{t("notes.conflict.body")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void copyMine()}>{t("notes.conflict.copy")}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void resolveConflict("overwrite")}>{t("notes.conflict.overwrite")}</Button>
              <Button type="button" size="sm" onClick={() => void resolveConflict("reload")}>{t("notes.conflict.reload")}</Button>
            </div>
          </div>
        )}
        {offeredDraft && (
          <div role="status" className="space-y-3 rounded-md border border-border bg-card p-4">
            <p className="font-medium text-foreground">{t("notes.draft.title")}</p>
            <p className="text-sm text-muted-foreground">{t("notes.draft.body")}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => { setDraft(offeredDraft); latest.current = offeredDraft; setSaveState("dirty"); keepDraft(id, null); setOfferedDraft(null); }}>{t("notes.draft.restore")}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { keepDraft(id, null); setOfferedDraft(null); }}>{t("notes.draft.discard")}</Button>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="note-title">{t("notes.titleLabel")}</Label>
          <Input id="note-title" value={draft.title} onChange={event => change({ title: event.target.value })} maxLength={MAX_NOTE_TITLE_CHARS} placeholder={t("notes.titlePlaceholder")} className="text-lg font-semibold" />
        </div>

        <div className="max-w-xs"><CourseSelect id="note-course" value={draft.course} onChange={course => change({ course })} /></div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label={t("notes.bodyLabel")} className="inline-flex rounded-md border border-border p-0.5">
            {([false, true] as const).map(preview => (
              <Button key={String(preview)} type="button" size="sm" variant={showPreview === preview ? "secondary" : "ghost"} aria-pressed={showPreview === preview} onClick={() => setShowPreview(preview)}>
                {preview ? t("notes.preview") : t("notes.write")}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span role="status" aria-live="polite" className={`text-sm ${saveState === "failed" || saveState === "conflict" ? "text-destructive" : "text-muted-foreground"}`}>{status}</span>
            {saveState === "failed" && <Button type="button" size="sm" variant="outline" onClick={() => void save()}>{t("notes.saveNow")}</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline" disabled={organize.isPending}>
                  {organize.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
                  {organize.isPending ? t("notes.ai.working") : t("notes.ai.menu")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void runOrganize("tidy")}>{t("notes.ai.tidy")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void runOrganize("summary")}>{t("notes.ai.summary")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void runOrganize("questions")}>{t("notes.ai.questions")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" size="icon" variant="ghost" aria-label={t("notes.delete")} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {showPreview ? (
          <div className="min-h-[24rem] rounded-md border border-border bg-card p-4">
            {draft.body.trim() ? <Markdown>{draft.body}</Markdown> : <p className="text-muted-foreground">{t("notes.previewEmpty")}</p>}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Textarea
              id="note-body"
              aria-label={t("notes.bodyLabel")}
              value={draft.body}
              onChange={event => change({ body: event.target.value })}
              maxLength={MAX_NOTE_BODY_CHARS}
              placeholder={t("notes.bodyPlaceholder")}
              className="min-h-[24rem] font-mono text-sm leading-relaxed"
            />
            <p className="text-right text-xs text-muted-foreground tabular-nums">{t("notes.chars", { count: formatNumber(draft.body.length), max: formatNumber(MAX_NOTE_BODY_CHARS) })}</p>
          </div>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("notes.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("notes.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("notes.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate({ id })}>{t("notes.deleteConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={suggestion !== null} onOpenChange={open => { if (!open) setSuggestion(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("notes.ai.previewTitle")}</DialogTitle>
            <DialogDescription>{t("notes.ai.previewHelp")}</DialogDescription>
          </DialogHeader>
          {stale && <p role="alert" className="text-sm text-destructive">{t("notes.ai.stale")}</p>}
          {suggestion?.shortened && <p className="text-sm text-muted-foreground">{t("notes.ai.shortened")}</p>}
          <div className="rounded-md border border-border bg-card p-4">{suggestion && <Markdown>{suggestion.markdown}</Markdown>}</div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" onClick={() => setSuggestion(null)}>{t("notes.ai.discard")}</Button>
            <Button type="button" variant="outline" onClick={() => applySuggestion("append")}>{t("notes.ai.append")}</Button>
            <Button type="button" disabled={stale} onClick={() => applySuggestion("replace")}>{t("notes.ai.replace")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>,
  );
}

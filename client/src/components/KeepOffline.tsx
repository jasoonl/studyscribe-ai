import { useEffect, useRef, useState } from "react";
import { CloudDownload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildOfflinePack, OFFLINE_OWNER_KEY } from "@/lib/offlinePack";
import { getPack, offlineStorageAvailable, removePack, savePack } from "@/lib/offlineStore";
import { t, useI18n } from "@/i18n";

type Props = {
  userId: number | undefined;
  recording: { id: number; title: string };
  transcript: { fullText?: string | null; segments?: unknown } | null | undefined;
  flashcards: Array<{ id: number; question: string; answer: string }> | undefined;
  notes: Array<{ id: number; title?: string | null; content?: string | null }> | undefined;
};

/**
 * "Keep offline" on the recording page (Phase 7): saves the transcript, flashcards and notes
 * on this device for /offline. A kept recording is refreshed whenever its page is opened.
 */
export function KeepOffline({ userId, recording, transcript, flashcards, notes }: Props) {
  const [kept, setKept] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshed = useRef(false);
  useI18n();

  const pack = () =>
    buildOfflinePack({
      userId: userId!,
      recording,
      transcript: transcript ? { fullText: transcript.fullText, segments: Array.isArray(transcript.segments) ? transcript.segments : [] } : null,
      flashcards,
      notes,
    });

  useEffect(() => {
    if (!userId || !offlineStorageAvailable()) return;
    getPack(userId, recording.id)
      .then((existing) => setKept(Boolean(existing)))
      .catch(() => setKept(false));
  }, [userId, recording.id]);

  // Keep a kept recording current once its data has loaded.
  useEffect(() => {
    if (!kept || refreshed.current || !userId || !transcript) return;
    refreshed.current = true;
    void savePack(pack()).catch(() => {});
  });

  if (!userId || kept === null) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (kept) {
        await removePack(recording.id);
        setKept(false);
        toast.success(t("recording.offlineRemoved"));
      } else {
        await savePack(pack());
        localStorage.setItem(OFFLINE_OWNER_KEY, String(userId));
        setKept(true);
        toast.success(t("recording.offlineKept"), { description: t("recording.offlineKeptText") });
      }
    } catch {
      toast.error(t("recording.offlineFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={toggle} disabled={busy} aria-pressed={kept}>
      <CloudDownload className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">{kept ? t("recording.offlineKept") : t("recording.keepOffline")}</span>
      <span className="sr-only sm:hidden">{kept ? t("recording.offlineKept") : t("recording.keepOffline")}</span>
    </Button>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOnline } from "@/components/OfflineStatus";
import { getFlashcardShortcutAction } from "@/lib/flashcardShortcuts";
import { formatTimestamp, OFFLINE_OWNER_KEY, type OfflinePack } from "@/lib/offlinePack";
import { listPacks, listQueuedReviews, offlineStorageAvailable, onOfflineChange, queueReview } from "@/lib/offlineStore";
import { localIsoDate } from "@shared/actionItems";

function ownerId(): number | null {
  try {
    const value = Number(localStorage.getItem(OFFLINE_OWNER_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Recordings kept on this device (Phase 7). Not behind sign-in: it has to open with no
 * connection, when the session can't be checked. It only reads this browser's own storage,
 * which sign-out clears.
 */
export default function Offline() {
  const online = useOnline();
  const [packs, setPacks] = useState<OfflinePack[] | null>(null);
  const [pending, setPending] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const userId = ownerId();
    if (!userId || !offlineStorageAvailable()) {
      setPacks([]);
      return;
    }
    try {
      setPacks(await listPacks(userId));
      setPending((await listQueuedReviews(userId)).length);
    } catch {
      setPacks([]);
    }
  }, []);

  useEffect(() => {
    void load();
    return onOfflineChange(() => void load());
  }, [load]);

  const open = packs?.find((p) => p.recordingId === openId) ?? null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center gap-3">
          {open ? (
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => setOpenId(null)}>
              <ArrowLeft className="h-4 w-4" />
              Offline recordings
            </Button>
          ) : (
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Library
              </Button>
            </Link>
          )}
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-24 pt-10" tabIndex={-1}>
        {open ? (
          <PackView pack={open} />
        ) : (
          <>
            <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Offline recordings</h1>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">
              Transcripts, flashcards and notes kept on this device. Choose Keep offline on a recording to add it here.
              {!online && " You are offline now; reviews you make are sent when the connection is back."}
            </p>
            {pending > 0 && (
              <p className="mt-4 text-sm tabular-nums" role="status">
                {pending} {pending === 1 ? "review is" : "reviews are"} waiting to be sent.
              </p>
            )}
            {packs === null ? null : packs.length === 0 ? (
              <Card className="mt-8 p-6">
                <h2 className="text-lg font-semibold">Nothing kept offline yet</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Open a recording while you are online and choose Keep offline. Signing out removes everything kept here.
                </p>
              </Card>
            ) : (
              <ul className="mt-8 space-y-2">
                {packs.map((pack) => (
                  <li key={pack.recordingId}>
                    <button
                      type="button"
                      onClick={() => setOpenId(pack.recordingId)}
                      className="block w-full rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block truncate font-medium">{pack.title}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {pack.flashcards.length} {pack.flashcards.length === 1 ? "card" : "cards"} · {pack.notes.length}{" "}
                        {pack.notes.length === 1 ? "note" : "notes"} · saved {new Date(pack.savedAt).toLocaleDateString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function PackView({ pack }: { pack: OfflinePack }) {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">{pack.title}</h1>
      <Tabs defaultValue={pack.flashcards.length ? "cards" : "transcript"} className="mt-6">
        <TabsList>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="cards">Flashcards</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        <TabsContent value="transcript" className="mt-6">
          {pack.segments.length > 0 ? (
            <ol className="space-y-3">
              {pack.segments.map((segment, index) => (
                <li key={index} className="grid grid-cols-[3.5rem_1fr] gap-3 text-sm leading-relaxed">
                  <span className="pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">{formatTimestamp(segment.start)}</span>
                  <span>
                    {segment.speaker && <span className="mr-2 font-medium text-primary">{segment.speaker}</span>}
                    {segment.text}
                  </span>
                </li>
              ))}
            </ol>
          ) : pack.fullText ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{pack.fullText}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No transcript was saved.</p>
          )}
        </TabsContent>
        <TabsContent value="cards" className="mt-6">
          <OfflineCards pack={pack} />
        </TabsContent>
        <TabsContent value="notes" className="mt-6 space-y-8">
          {pack.notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes were saved.</p>
          ) : (
            pack.notes.map((note) => (
              <article key={note.id}>
                <h2 className="mb-3 text-lg font-semibold">{note.title}</h2>
                {/* Plain text: the Markdown renderer is a large file that may not be on this device offline. */}
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.content}</p>
              </article>
            ))
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

function OfflineCards({ pack }: { pack: OfflinePack }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [shownAt, setShownAt] = useState(() => Date.now());
  const card = pack.flashcards[index];

  const grade = async (status: "learning" | "mastered") => {
    if (!card) return;
    try {
      await queueReview({
        userId: pack.userId,
        recordingId: pack.recordingId,
        flashcardId: card.id,
        status,
        seconds: (Date.now() - shownAt) / 1000,
        localDate: localIsoDate(new Date()),
        queuedAt: Date.now(),
      });
    } catch {
      // Storage refused: the review still moves on; it just isn't counted.
    }
    setIndex((i) => i + 1);
    setRevealed(false);
    setShownAt(Date.now());
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = getFlashcardShortcutAction({ key: event.key, isRevealed: revealed, isSubmitting: false, target: event.target as HTMLElement | null });
      if (!action) return;
      event.preventDefault();
      if (action === "toggle") setRevealed((r) => !r);
      else void grade(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (pack.flashcards.length === 0) return <p className="text-sm text-muted-foreground">No flashcards were saved.</p>;
  if (!card) {
    return (
      <Card className="p-6" role="status">
        <h2 className="text-lg font-semibold">All {pack.flashcards.length} cards reviewed</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your answers go to your study plan when you are back online.</p>
        <Button variant="outline" className="mt-4 w-fit" onClick={() => setIndex(0)}>Go through them again</Button>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
        Card {index + 1} of {pack.flashcards.length}
      </p>
      <Card className="gap-0 overflow-hidden p-0">
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? "Hide the answer" : "Reveal the answer"}
          className="block min-h-56 w-full p-6 text-left hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{revealed ? "Answer" : "Question"}</span>
          <span className="mt-3 block text-xl font-semibold leading-relaxed">{revealed ? card.answer : card.question}</span>
        </button>
      </Card>
      {revealed ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant="outline" size="lg" onClick={() => grade("learning")}>Still learning</Button>
          <Button size="lg" onClick={() => grade("mastered")}>I knew it</Button>
        </div>
      ) : (
        <Button size="lg" className="w-full" onClick={() => setRevealed(true)}>Reveal answer</Button>
      )}
    </div>
  );
}

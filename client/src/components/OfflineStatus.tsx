import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { isNetworkFailure, OFFLINE_OWNER_KEY } from "@/lib/offlinePack";
import { listQueuedReviews, offlineStorageAvailable, onOfflineChange, removeQueuedReview } from "@/lib/offlineStore";

export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

function ownerId(): number | null {
  try {
    const value = Number(localStorage.getItem(OFFLINE_OWNER_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Sends flashcard reviews made offline once the connection is back (Phase 7), and tells
 * people when they are offline. Mounted once, above the router.
 */
export function OfflineStatus() {
  const online = useOnline();
  const [location] = useLocation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!online || !offlineStorageAvailable()) return;
    let running = false;
    const flush = async () => {
      const userId = ownerId();
      if (running || !userId) return;
      running = true;
      let sent = 0;
      try {
        for (const review of await listQueuedReviews(userId)) {
          try {
            await utils.client.ai.reviewFlashcard.mutate({
              recordingId: review.recordingId,
              flashcardId: review.flashcardId,
              status: review.status,
              seconds: review.seconds,
              localDate: review.localDate,
            });
            sent += 1;
            await removeQueuedReview(review.id!);
          } catch (error) {
            if (isNetworkFailure(error)) break; // try again when the connection is back
            await removeQueuedReview(review.id!); // the card or recording is gone, or it isn't this account's
          }
        }
      } catch {
        // Offline storage unavailable.
      } finally {
        running = false;
      }
      if (sent > 0) {
        toast.success(`Saved ${sent} ${sent === 1 ? "review" : "reviews"} you made offline`);
        void utils.planner.invalidate();
      }
    };
    void flush();
    return onOfflineChange(() => void flush());
  }, [online, utils]);

  if (online || location === "/offline") return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-md">
        <span>You are offline.</span>
        <Link href="/offline" className="font-medium text-primary underline underline-offset-4">Open recordings kept offline</Link>
      </p>
    </div>
  );
}

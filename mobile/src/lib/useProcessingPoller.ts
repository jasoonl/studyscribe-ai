import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router";
import { trpc } from "./trpc";

export const POLL_INTERVAL_MS = 3000;

/**
 * Same rule as the web: while a screen shows a processing recording, call
 * recordings.getStatus every 3s. Without a webhook configured this call is
 * what moves the transcription forward on the server, so a screen that shows
 * a processing recording must keep polling. Stops when the screen is not
 * focused or the app is in the background (push says when it is done).
 */
export function useProcessingPoller(ids: number[], onSettled?: (id: number, status: string | null) => void) {
  const utils = trpc.useUtils();
  const focused = useIsFocused();
  const key = ids.join(",");
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useEffect(() => {
    if (!focused || ids.length === 0) return;
    let active = AppState.currentState === "active";
    const appSubscription = AppState.addEventListener("change", (next) => {
      active = next === "active";
    });
    const pending = new Set(ids);
    const timer = setInterval(async () => {
      if (!active) return;
      for (const id of [...pending]) {
        try {
          const result = await utils.client.recordings.getStatus.query({ id });
          if (result.status !== "processing") {
            pending.delete(id);
            onSettledRef.current?.(id, result.status ?? null);
            utils.recordings.list.invalidate().catch(() => undefined);
            utils.recordings.get.invalidate({ id }).catch(() => undefined);
            utils.transcription.get.invalidate({ recordingId: id }).catch(() => undefined);
          }
        } catch {
          // Try again on the next tick.
        }
      }
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      appSubscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, focused, utils]);
}

import { useCallback } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { uploadSlides, type CapturedSlide } from "@/lib/slideCapture";

/**
 * Uploads the slides captured during a recording once the recording is
 * saved. Runs in the background: a slide that fails never affects the
 * recording, and the person is told how many were kept.
 */
export function useSaveSlides() {
  const utils = trpc.useUtils();
  const add = trpc.slides.add.useMutation();
  return useCallback(
    (recordingId: number, slides: CapturedSlide[]) => {
      if (slides.length === 0) return;
      void (async () => {
        const capacity = await utils.slides.capacity.fetch().catch(() => null);
        if (capacity && !capacity.room) {
          toast.warning("Storage is nearly full, so the captured slides were not saved. The recording is safe.");
          return;
        }
        const result = await uploadSlides(recordingId, slides, input => add.mutateAsync(input));
        await utils.slides.list.invalidate({ recordingId });
        if (result.error) {
          toast.warning(result.saved > 0 ? `Saved ${result.saved} of ${slides.length} slides. ${result.error}` : `Slides were not saved. ${result.error}`);
        } else {
          toast.success(`Saved ${result.saved} ${result.saved === 1 ? "slide" : "slides"} with the recording.`);
        }
      })();
    },
    [add, utils],
  );
}

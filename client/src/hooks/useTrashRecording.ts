import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

/**
 * Moves a recording to the trash and offers Undo in the toast. Trash is
 * reversible, so an undo is kinder than a confirmation dialog.
 */
export function useTrashRecording() {
  const utils = trpc.useUtils();
  const remove = trpc.recordings.delete.useMutation();
  const restore = trpc.recordings.restore.useMutation();

  const refresh = () =>
    Promise.all([utils.recordings.list.invalidate(), utils.recordings.listDeleted.invalidate(), utils.courses.list.invalidate()]);

  return async (id: number) => {
    try {
      await remove.mutateAsync({ id });
      await refresh();
      toast.success("Moved to trash", {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await restore.mutateAsync({ id });
              await refresh();
              toast.success("Recording restored");
            } catch {
              toast.error("Could not restore it. It is still in Trash.");
            }
          },
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not move the recording to trash");
    }
  };
}

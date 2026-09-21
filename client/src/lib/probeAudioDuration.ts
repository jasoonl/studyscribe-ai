/**
 * Reads a file's duration before upload, for the file-picker and drag-and-drop
 * paths where the audio was never captured with a running timer the way a
 * microphone recording is. Unlike a live MediaRecorder stream, a file loaded
 * from disk is a finalized container and normally reports its duration
 * immediately — this never blocks the upload if it can't (corrupt file,
 * unsupported codec): it resolves 0 instead of rejecting.
 */
export function probeAudioDuration(file: Blob, timeoutMs = 5000): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    let settled = false;

    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
      URL.revokeObjectURL(url);
      resolve(value);
    };

    const onLoaded = () => {
      const duration = audio.duration;
      finish(Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0);
    };
    const onError = () => finish(0);
    const timer = setTimeout(() => finish(0), timeoutMs);

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("error", onError);
    audio.preload = "metadata";
    audio.src = url;
  });
}

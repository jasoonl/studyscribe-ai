import { Readable } from "node:stream";
import { parseStream } from "music-metadata";

/**
 * Recordings from a link import never had their length measured — the field
 * was hardcoded to 0, which the UI then rendered as a bare "N/A". This reads
 * duration from the audio's own container/format headers without needing
 * ffmpeg (unavailable in this serverless runtime) or fully decoding the file.
 *
 * Failure here must never fail the import: an unusual or slightly malformed
 * file can still transcribe fine even if its duration can't be determined.
 */
export async function probeAudioDuration(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  sizeHint: number | null,
): Promise<number | null> {
  try {
    const metadata = await parseStream(
      Readable.fromWeb(stream as never),
      { mimeType, size: sizeHint ?? undefined },
      { duration: true },
    );
    const duration = metadata.format.duration;
    return typeof duration === "number" && Number.isFinite(duration) && duration > 0
      ? Math.round(duration)
      : null;
  } catch (error) {
    console.warn(`[AudioDuration] Could not determine duration: ${error instanceof Error ? error.message : error}`);
    return null;
  } finally {
    // parseStream can return before consuming the whole stream once it has
    // enough header data; draining what's left avoids leaving the tee'd
    // branch half-read.
    await stream.cancel().catch(() => undefined);
  }
}

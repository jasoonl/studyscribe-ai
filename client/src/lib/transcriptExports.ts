import { formatTranscriptTimestamp, type TranscriptSegment } from "./transcriptSegments";

export type TranscriptExportFormat = "txt" | "srt" | "vtt";

type ExportFile = { content: string; mimeType: string; extension: string };

/** 00:01:02,345 (SRT) or 00:01:02.345 (VTT). */
function subtitleTime(seconds: number, separator: "," | ".") {
  const totalMs = Math.max(0, Math.round((seconds || 0) * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (value: number, size = 2) => value.toString().padStart(size, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(ms, 3)}`;
}

function cueText(segment: TranscriptSegment) {
  const text = segment.text.replace(/\s+/g, " ").trim();
  return segment.speaker ? `${segment.speaker}: ${text}` : text;
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Plain text keeps a speaker heading only when the speaker changes, with a
 * timestamp per line so the file can still be read against the audio.
 * Editing the transcript changes only the full text, not the segments, so an
 * edited transcript is exported as its full text to keep the edits.
 */
function toPlainText(segments: TranscriptSegment[], fullText: string, title: string) {
  const edited = normalize(fullText) !== normalize(segments.map(segment => segment.text).join(" "));
  if (segments.length === 0 || edited) return `${title}\n\n${fullText.trim()}\n`;
  const lines: string[] = [title, ""];
  segments.forEach((segment, index) => {
    if (segment.speaker && segment.speaker !== segments[index - 1]?.speaker) {
      if (index > 0) lines.push("");
      lines.push(`${segment.speaker}:`);
    }
    lines.push(`[${formatTranscriptTimestamp(segment.start)}] ${segment.text.replace(/\s+/g, " ").trim()}`);
  });
  return `${lines.join("\n")}\n`;
}

function toSrt(segments: TranscriptSegment[]) {
  return segments
    .map((segment, index) => `${index + 1}\n${subtitleTime(segment.start, ",")} --> ${subtitleTime(segment.end, ",")}\n${cueText(segment)}\n`)
    .join("\n");
}

function toVtt(segments: TranscriptSegment[]) {
  const cues = segments.map(segment => `${subtitleTime(segment.start, ".")} --> ${subtitleTime(segment.end, ".")}\n${cueText(segment)}\n`);
  return ["WEBVTT", "", ...cues].join("\n");
}

export function createTranscriptExport(
  input: { segments: TranscriptSegment[]; fullText: string; title: string },
  format: TranscriptExportFormat,
): ExportFile {
  const segments = input.segments.filter(segment => segment.text.trim().length > 0);
  if (format === "srt") return { content: toSrt(segments), mimeType: "application/x-subrip;charset=utf-8", extension: "srt" };
  if (format === "vtt") return { content: toVtt(segments), mimeType: "text/vtt;charset=utf-8", extension: "vtt" };
  return { content: toPlainText(segments, input.fullText, input.title), mimeType: "text/plain;charset=utf-8", extension: "txt" };
}

export function downloadTranscriptExport(input: { segments: TranscriptSegment[]; fullText: string; title: string }, format: TranscriptExportFormat) {
  const file = createTranscriptExport(input, format);
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const link = document.createElement("a");
  const safeName = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "transcript";
  link.href = url;
  link.download = `${safeName}.${file.extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

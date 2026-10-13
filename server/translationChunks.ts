import { createHash } from "crypto";

/**
 * Splitting long text for translation (F7). One function call has 60 seconds,
 * which a whole lecture transcript would not fit in, so the client translates
 * one chunk per request. A chunk is small enough for the model to translate
 * in a few seconds and large enough to keep sentences in context.
 */

/** Characters of source text per chunk. About 700 tokens in, a similar amount out: a few seconds per request. */
export const TRANSLATION_CHUNK_CHARS = 2400;
/** Bump when chunking changes, so stored translations made with the old chunks are not reused. */
const CHUNKER_VERSION = "1";

export type SourceLine = { start: number | null; speaker: string | null; text: string };
export type TranslationChunk = {
  index: number;
  /** For transcripts with current timestamps: the lines, translated one for one so times and speakers stay. */
  lines: SourceLine[] | null;
  /** The text sent for translation (Markdown for notes and guides). */
  text: string;
  hash: string;
};

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

export function hashChunk(text: string, lines: SourceLine[] | null) {
  const material = lines ? JSON.stringify(lines.map((line) => [line.start, line.speaker, line.text])) : text;
  return createHash("sha256").update(`${CHUNKER_VERSION}\n${material}`).digest("hex");
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?]*\s*/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
}

/** Packs pieces into chunks of at most `maxChars`, never splitting a piece unless it alone is too long. */
function pack(pieces: string[], maxChars: number, joiner: string): string[] {
  const out: string[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer.trim()) out.push(buffer);
    buffer = "";
  };
  for (const piece of pieces) {
    if (piece.length > maxChars) {
      flush();
      // A single huge paragraph: fall back to sentences, then to hard cuts.
      for (const sentence of splitSentences(piece)) {
        if (sentence.length > maxChars) {
          for (let i = 0; i < sentence.length; i += maxChars) out.push(sentence.slice(i, i + maxChars));
          continue;
        }
        if (buffer && buffer.length + 1 + sentence.length > maxChars) flush();
        buffer = buffer ? `${buffer} ${sentence}` : sentence;
      }
      flush();
      continue;
    }
    if (buffer && buffer.length + joiner.length + piece.length > maxChars) flush();
    buffer = buffer ? `${buffer}${joiner}${piece}` : piece;
  }
  flush();
  return out;
}

/** Markdown (notes, guides): split at blank lines, preferring to start a chunk at a heading. */
export function chunkMarkdown(markdown: string, maxChars = TRANSLATION_CHUNK_CHARS): TranslationChunk[] {
  const blocks = markdown.replace(/\r\n/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  // Keep a heading with the paragraph that follows it.
  const merged: string[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (previous && /^#{1,6}\s/.test(previous) && !previous.includes("\n")) merged[merged.length - 1] = `${previous}\n\n${block}`;
    else merged.push(block);
  }
  return pack(merged, maxChars, "\n\n").map((text, index) => ({ index, lines: null, text, hash: hashChunk(text, null) }));
}

type Segment = { start?: number; text?: string; speaker?: string | null };

/**
 * Transcripts: when the timed lines still match the text, chunks are runs of
 * whole lines, translated line for line so times and speakers carry over.
 * An edited transcript changes only its full text, so its lines are stale;
 * then the full text is translated in sentence chunks without times, the
 * same rule the TXT export uses.
 */
export function chunkTranscript(fullText: string, segments: Segment[] | null | undefined, maxChars = TRANSLATION_CHUNK_CHARS): TranslationChunk[] {
  const lines: SourceLine[] = (segments ?? [])
    .filter((segment) => typeof segment?.text === "string" && segment.text.trim())
    .map((segment) => ({ start: Number.isFinite(segment.start) ? Number(segment.start) : null, speaker: segment.speaker?.trim() || null, text: normalize(segment.text!) }));
  const edited = normalize(fullText) !== normalize(lines.map((line) => line.text).join(" "));

  if (lines.length === 0 || edited) {
    const paragraphs = fullText.replace(/\r\n/g, "\n").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    return pack(paragraphs.length ? paragraphs : [fullText.trim()], maxChars, "\n\n")
      .filter((text) => text.trim())
      .map((text, index) => ({ index, lines: null, text, hash: hashChunk(text, null) }));
  }

  const chunks: TranslationChunk[] = [];
  let current: SourceLine[] = [];
  let length = 0;
  const flush = () => {
    if (!current.length) return;
    const text = current.map((line) => line.text).join("\n");
    chunks.push({ index: chunks.length, lines: current, text, hash: hashChunk(text, current) });
    current = [];
    length = 0;
  };
  for (const line of lines) {
    if (current.length && length + line.text.length + 1 > maxChars) flush();
    current.push(line);
    length += line.text.length + 1;
  }
  flush();
  return chunks;
}

/**
 * Reads the model's answer for a chunk of lines. It must return exactly one
 * translated line per source line; anything else is rejected so the caller can
 * fall back to translating the chunk as plain text.
 */
export function parseTranslatedLines(value: unknown, expected: number): string[] | null {
  const lines = (value as { lines?: unknown })?.lines;
  if (!Array.isArray(lines) || lines.length !== expected) return null;
  if (!lines.every((line) => typeof line === "string")) return null;
  return lines.map((line) => (line as string).trim());
}

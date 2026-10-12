/**
 * Pure helpers for "Ask StudyScribe": turn a natural-language question into
 * search terms, split transcripts into passages, rank them, build the prompt
 * and read the citations back out of the answer. No database, no network.
 */

export type TranscriptSegmentLike = { start: number; end?: number; text: string; speaker?: string };

export type AskSource = {
  recordingId: number;
  title: string;
  fullText: string;
  segments: TranscriptSegmentLike[] | null;
};

export type Passage = {
  recordingId: number;
  title: string;
  /** Seconds into the recording, or null when the transcript has no timestamps. */
  start: number | null;
  text: string;
};

export type Citation = {
  n: number;
  recordingId: number;
  title: string;
  start: number | null;
  snippet: string;
};

export const MAX_SEARCH_TERMS = 8;
export const MAX_PASSAGES = 12;
export const MAX_PASSAGES_PER_RECORDING = 4;
const PASSAGE_TARGET_CHARS = 700;

const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are aren't as at be because been before being below between both but by " +
    "can can't could did do does doing don't down during each few for from further had has have having he her here hers him his how i if in " +
    "into is isn't it its just let me more most my no nor not of off on once only or other our out over own same she should so some such " +
    "than that the their them then there these they this those through to too under until up very was we were what when where which while " +
    "who whom why will with would you your yours explain tell said say says mention mentioned discuss discussed lecture lectures class " +
    "recording recordings professor teacher did does talk talked about across everything anything something"
  ).split(/\s+/),
);

/** Cheap plural/suffix trim so "mitochondria's" and "enzymes" still find "enzyme". Matching is by substring, so a short stem is fine. */
export function stem(word: string): string {
  let result = word;
  if (result.length > 5 && result.endsWith("ing")) result = result.slice(0, -3);
  else if (result.length > 4 && result.endsWith("ed")) result = result.slice(0, -2);
  else if (result.length > 4 && result.endsWith("ies")) result = result.slice(0, -3) + "y";
  else if (result.length > 3 && result.endsWith("s") && !result.endsWith("ss")) result = result.slice(0, -1);
  return result;
}

export function extractSearchTerms(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[\s.,;:!?()\[\]{}"“”‘’'`´\-–—/\\|<>=+*&^%$#@~]+/)
    .filter(word => word.length >= 2 && !STOPWORDS.has(word));
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of words) {
    const root = stem(word);
    if (root.length < 2 || seen.has(root)) continue;
    seen.add(root);
    terms.push(root);
  }
  // Longer words are more distinctive, so keep those when there are too many.
  return terms
    .map((term, index) => ({ term, index }))
    .sort((a, b) => b.term.length - a.term.length || a.index - b.index)
    .slice(0, MAX_SEARCH_TERMS)
    .sort((a, b) => a.index - b.index)
    .map(item => item.term);
}

/** Escapes LIKE wildcards so a term containing % or _ is matched literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, match => `\\${match}`);
}

function splitSentences(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?]*\s*/g)?.map(part => part.trim()).filter(Boolean) ?? [text];
}

/** Groups consecutive segments (or, without timestamps, sentences) into passages of roughly `maxChars`. */
export function buildPassages(source: AskSource, maxChars = PASSAGE_TARGET_CHARS): Passage[] {
  const passages: Passage[] = [];
  const base = { recordingId: source.recordingId, title: source.title };

  const segments = (source.segments ?? []).filter(segment => segment && typeof segment.text === "string" && segment.text.trim());
  // Editing a transcript changes fullText but not segments; if they have drifted
  // far apart, prefer what the person last saw (fullText) over stale timestamps.
  const segmentChars = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  const segmentsAreCurrent = segments.length > 0 && segmentChars >= source.fullText.length * 0.6 && segmentChars <= source.fullText.length * 1.6;

  if (segmentsAreCurrent) {
    let current: { start: number; parts: string[]; length: number } | null = null;
    for (const segment of segments) {
      const text = segment.text.trim();
      if (!current) current = { start: Number.isFinite(segment.start) ? segment.start : 0, parts: [], length: 0 };
      current.parts.push(text);
      current.length += text.length + 1;
      if (current.length >= maxChars) {
        passages.push({ ...base, start: current.start, text: current.parts.join(" ") });
        current = null;
      }
    }
    if (current) passages.push({ ...base, start: current.start, text: current.parts.join(" ") });
    return passages;
  }

  let buffer = "";
  for (const sentence of splitSentences(source.fullText)) {
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
    if (buffer.length >= maxChars) {
      passages.push({ ...base, start: null, text: buffer });
      buffer = "";
    }
  }
  if (buffer.trim()) passages.push({ ...base, start: null, text: buffer });
  return passages;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * TF-IDF style ranking: terms that appear in few passages count for more, and
 * a passage that covers more of the question's terms beats one that repeats a
 * single common term. Zero-match passages are dropped. A cap per recording
 * keeps one long lecture from crowding out the others.
 */
export function rankPassages(
  passages: Passage[],
  terms: string[],
  options: { limit?: number; perRecording?: number } = {},
): Passage[] {
  const limit = options.limit ?? MAX_PASSAGES;
  const perRecording = options.perRecording ?? MAX_PASSAGES_PER_RECORDING;
  if (terms.length === 0 || passages.length === 0) return [];

  const lowered = passages.map(passage => passage.text.toLowerCase());
  const docFrequency = terms.map(term => lowered.filter(text => text.includes(term)).length);

  const scored = passages
    .map((passage, index) => {
      let score = 0;
      let matched = 0;
      terms.forEach((term, termIndex) => {
        const tf = countOccurrences(lowered[index], term);
        if (tf === 0) return;
        matched += 1;
        const idf = Math.log(1 + passages.length / (1 + docFrequency[termIndex]));
        score += idf * (1 + Math.log(tf));
      });
      return { passage, score: score * (0.4 + 0.6 * (matched / terms.length)), matched, index };
    })
    .filter(item => item.matched > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const taken = new Map<number, number>();
  const result: Passage[] = [];
  for (const item of scored) {
    const used = taken.get(item.passage.recordingId) ?? 0;
    if (used >= perRecording) continue;
    taken.set(item.passage.recordingId, used + 1);
    result.push(item.passage);
    if (result.length >= limit) break;
  }
  return result;
}

export function formatTimestamp(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export type AskHistoryMessage = { role: "user" | "assistant"; content: string };

export function buildAskMessages(question: string, passages: Passage[], history: AskHistoryMessage[] = []) {
  const excerpts = passages
    .map((passage, index) => {
      const at = formatTimestamp(passage.start);
      return `[${index + 1}] "${passage.title}"${at ? ` at ${at}` : ""}\n${passage.text}`;
    })
    .join("\n\n");

  const system = [
    "You answer a student's question using only the numbered excerpts below, taken from their own recorded lectures and meetings.",
    "Cite every claim with the excerpt number in square brackets, like [2] or [1][3]. Never cite a number that is not listed.",
    "If the excerpts do not answer the question, say plainly that you could not find it in the recordings, and do not guess from outside knowledge.",
    "When excerpts from different recordings disagree or build on each other, say which recording each point comes from.",
    "Be concise and write in plain prose or a short list. Do not repeat the excerpts word for word.",
    "",
    "Excerpts:",
    excerpts,
  ].join("\n");

  return [
    { role: "system" as const, content: system },
    ...history.slice(-6).map(message => ({ role: message.role, content: message.content.slice(0, 4000) })),
    { role: "user" as const, content: question },
  ];
}

/** Reads `[1]`, `[2][3]` and `[1, 4]` markers and returns each cited passage once, in order of first mention. */
export function parseCitations(answer: string, passages: Passage[]): Citation[] {
  const order: number[] = [];
  const marker = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(answer)) !== null) {
    for (const part of match[1].split(",")) {
      const n = Number.parseInt(part.trim(), 10);
      if (n >= 1 && n <= passages.length && !order.includes(n)) order.push(n);
    }
  }
  return order.map(n => {
    const passage = passages[n - 1];
    const snippet = passage.text.length > 180 ? `${passage.text.slice(0, 177).trimEnd()}...` : passage.text;
    return { n, recordingId: passage.recordingId, title: passage.title, start: passage.start, snippet };
  });
}

export const NOTHING_FOUND_ANSWER =
  "I could not find that in your recordings. Try different keywords, or pick a different course if you filtered by one.";

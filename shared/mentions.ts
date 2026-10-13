/**
 * @mentions in transcript comments. A mention is "@" followed by the display
 * name of someone who can see the comments on that recording (the owner and
 * comment or edit shares, directly or through a group). The server works out
 * who was mentioned from the text against that list, so a client cannot
 * notify someone who could not read the comment; the client uses the same
 * matching to highlight mentions.
 */

export type MentionCandidate = { id: number; name: string };

/** Longest, so "@Ana Maria" wins over "@Ana" when both people exist. */
export const MAX_MENTION_NAME = 80;
/** At most this many people are notified by one comment. */
export const MAX_MENTIONS_PER_COMMENT = 10;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usableName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 && trimmed.length <= MAX_MENTION_NAME ? trimmed : null;
}

function mentionPattern(name: string) {
  // Preceded by start or a non-word character, followed by a non-letter/digit.
  return new RegExp(`(^|[^\\p{L}\\p{N}_@])@${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, "iu");
}

/** Ids of the candidates whose "@Name" appears in the text, at most `MAX_MENTIONS_PER_COMMENT`. */
export function mentionedIds(body: string, candidates: MentionCandidate[]): number[] {
  if (!body.includes("@")) return [];
  const found: number[] = [];
  for (const candidate of candidates) {
    const name = usableName(candidate.name);
    if (!name || found.includes(candidate.id)) continue;
    if (mentionPattern(name).test(body)) found.push(candidate.id);
    if (found.length >= MAX_MENTIONS_PER_COMMENT) break;
  }
  return found;
}

/** Splits text into plain and mention parts for display. */
export function splitMentions(body: string, names: string[]): Array<{ text: string; mention: boolean }> {
  const usable = Array.from(new Set(names.map(usableName).filter((name): name is string => Boolean(name)))).sort((a, b) => b.length - a.length);
  if (!body.includes("@") || usable.length === 0) return [{ text: body, mention: false }];
  const pattern = new RegExp(`@(?:${usable.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  const parts: Array<{ text: string; mention: boolean }> = [];
  let last = 0;
  for (const match of Array.from(body.matchAll(pattern))) {
    const index = match.index ?? 0;
    const before = index > 0 ? body[index - 1] : "";
    if (before && new RegExp("[\\p{L}\\p{N}_@]", "u").test(before)) continue;
    if (index > last) parts.push({ text: body.slice(last, index), mention: false });
    parts.push({ text: match[0], mention: true });
    last = index + match[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), mention: false });
  return parts.length ? parts : [{ text: body, mention: false }];
}

/**
 * The "@query" being typed at the caret, if any: the text after the last "@"
 * that starts a word, up to the caret, with no line break in it.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && new RegExp("[\\p{L}\\p{N}_]", "u").test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /\s\s/.test(query)) return null;
  return { start: at, query };
}

/** Candidates whose name starts with, or has a word starting with, the query. */
export function filterCandidates(candidates: MentionCandidate[], query: string, limit = 6): MentionCandidate[] {
  const q = query.trim().toLocaleLowerCase();
  const matches = candidates.filter(candidate => {
    const name = candidate.name.toLocaleLowerCase();
    return !q || name.startsWith(q) || name.split(/\s+/).some(word => word.startsWith(q));
  });
  return matches.slice(0, limit);
}

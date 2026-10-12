import { z } from "zod";

/**
 * Custom vocabulary (B2): words the transcription provider should expect.
 * AssemblyAI takes them as `keyterms_prompt` (its older `word_boost` is not
 * honoured by current models). A term is at most six words; Universal-2 takes
 * up to 200 terms, so that is the cap for everything sent with one job.
 */
export const MAX_TERM_WORDS = 6;
export const MAX_TERM_LENGTH = 80;
export const MAX_TERMS_PER_LIST = 200;
export const MAX_KEYTERMS_PER_JOB = 200;

/** One term per line or comma; trims, collapses spaces and drops duplicates and over-long entries. */
export function parseVocabulary(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const pieces = Array.isArray(input) ? input : input.split(/[\n,;]+/);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const piece of pieces) {
    const term = String(piece).replace(/\s+/g, " ").trim();
    if (term.length < 2 || term.length > MAX_TERM_LENGTH) continue;
    if (term.split(" ").length > MAX_TERM_WORDS) continue;
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_TERMS_PER_LIST) break;
  }
  return terms;
}

/** Terms given for one recording come first, then the person's standing list, without repeats. */
export function mergeKeyterms(recordingTerms: string[], userTerms: string[], max = MAX_KEYTERMS_PER_JOB): string[] {
  return parseVocabulary([...recordingTerms, ...userTerms]).slice(0, max);
}

export function serializeVocabulary(terms: string[]): string {
  return terms.join("\n");
}

/** Accepted on create, createFromUrl and retryTranscription. */
export const keytermsInput = z.array(z.string().max(MAX_TERM_LENGTH * 2)).max(MAX_TERMS_PER_LIST * 2).optional();

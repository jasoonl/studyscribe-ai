import { z } from "zod";
import { COURSE_COLOR_KEYS } from "@shared/courseColors";

export const MAX_COURSES_PER_USER = 100;
export const MAX_TAGS_PER_USER = 60;
export const MAX_TAGS_PER_RECORDING = 12;

/** Collapses runs of whitespace so "  Intro   to  Bio " and "Intro to Bio" are the same name. */
export function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export const labelSchema = (max: number) =>
  z
    .string()
    .transform(normalizeLabel)
    .pipe(z.string().min(1, "Give it a name").max(max, `Keep it under ${max} characters`));

export const courseColorSchema = z.enum(COURSE_COLOR_KEYS);

export const courseInputSchema = z.object({
  name: labelSchema(120),
  color: courseColorSchema.optional(),
  term: z
    .string()
    .transform(normalizeLabel)
    .pipe(z.string().max(64))
    .optional()
    .transform(value => (value ? value : undefined)),
});

export const courseUpdateSchema = z.object({
  id: z.number().int().positive(),
  name: labelSchema(120).optional(),
  color: courseColorSchema.optional(),
  /** An empty string clears the term. */
  term: z.string().transform(normalizeLabel).pipe(z.string().max(64)).optional(),
});

export const tagInputSchema = z.object({
  name: labelSchema(40),
  color: courseColorSchema.optional(),
});

/** Case-insensitive duplicate check against the names a person already has. */
export function hasDuplicateName(existing: Array<{ id: number; name: string }>, name: string, ignoreId?: number): boolean {
  const wanted = normalizeLabel(name).toLowerCase();
  return existing.some(item => item.id !== ignoreId && normalizeLabel(item.name).toLowerCase() === wanted);
}

/** De-duplicates ids and keeps only those the person owns, preserving the order they were given in. */
export function keepOwnedIds(requested: number[], ownedIds: Iterable<number>): number[] {
  const owned = new Set(ownedIds);
  const seen = new Set<number>();
  const result: number[] = [];
  for (const id of requested) {
    if (owned.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/** Which tag ids to add and which to drop to turn `current` into `next`. */
export function diffTagIds(current: number[], next: number[]): { add: number[]; remove: number[] } {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    add: next.filter(id => !currentSet.has(id)),
    remove: current.filter(id => !nextSet.has(id)),
  };
}

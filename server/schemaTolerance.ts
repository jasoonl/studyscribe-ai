import { TRPCError } from "@trpc/server";
import { isMissingTableError } from "./bookmarks";

export { isMissingTableError };

/**
 * Migrations are applied by hand (`npm run db:migrate`), so a deploy can run
 * before the tables and columns it uses exist. These helpers let a feature turn
 * itself off instead of breaking the pages around it.
 */
export function isUnknownColumnError(error: unknown): boolean {
  for (let current: any = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (current.code === "ER_BAD_FIELD_ERROR" || current.errno === 1054) return true;
    if (typeof current.message === "string" && /Unknown column/i.test(current.message)) return true;
  }
  return false;
}

export function isSchemaMissingError(error: unknown) {
  return isMissingTableError(error) || isUnknownColumnError(error);
}

/** Runs `work`; when the schema is not migrated yet, logs once per feature and returns `fallback`. */
export async function tolerateMissingSchema<T>(feature: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isSchemaMissingError(error)) {
      warnOnce(feature);
      return fallback;
    }
    throw error;
  }
}

/** Runs `work`; when the schema is not migrated yet, throws a clear PRECONDITION_FAILED instead. */
export async function explainMissingSchema<T>(feature: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isSchemaMissingError(error)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${feature} ${feature.endsWith("s") ? "are" : "is"} not set up on this server yet.` });
    }
    throw error;
  }
}

const warned = new Set<string>();
function warnOnce(feature: string) {
  if (warned.has(feature)) return;
  warned.add(feature);
  console.warn(`[${feature}] tables missing; run \`npm run db:migrate\` (migration 0022) to enable it`);
}

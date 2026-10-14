import { safeNextPath } from "@shared/safeNext";

/** A same-site path from a `?next=` parameter, or null; never another site. See `shared/safeNext.ts`. */
export function safeNext(value: string | null | undefined): string | null {
  return safeNextPath(value);
}

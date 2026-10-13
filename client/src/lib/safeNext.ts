/** A same-site path from a `?next=` parameter, or null; never another site (no "//host" or "https://"). */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || value.length > 300) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /[\r\n]/.test(value)) return null;
  return value;
}

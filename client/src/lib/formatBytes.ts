/** File size as people read it: "812 KB", "3.4 MB". Pass the locale's number formatter. */
export function formatBytes(bytes: number, format: (value: number, options?: Intl.NumberFormatOptions) => string = value => String(value)): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${format(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${format(Math.round(kb))} KB`;
  const mb = kb / 1024;
  return `${format(mb, { maximumFractionDigits: mb < 10 ? 1 : 0, minimumFractionDigits: 0 })} MB`;
}

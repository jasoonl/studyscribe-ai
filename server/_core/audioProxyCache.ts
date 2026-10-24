import { createHash } from "node:crypto";

/**
 * Small per-process helpers for the audio proxy: validators for browser
 * caching, a memory of which keys Blob answers Range for, and a bounded
 * in-memory copy of recently fetched objects. Nothing here decides who may read
 * audio; callers check access before every read, so a cached body is never
 * handed to someone who has not passed that check.
 */

/** Stored keys carry a random UUID and are never overwritten, so a key-derived tag is a safe validator. */
export function audioEtag(key: string): string {
  return `"${createHash("sha256").update(key).digest("hex").slice(0, 24)}"`;
}

export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
}

export class RangeSupportMemory {
  private readonly map = new Map<string, boolean>();
  constructor(private readonly max = 200) {}
  get(key: string): boolean | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }
  set(key: string, honored: boolean) {
    this.map.delete(key);
    this.map.set(key, honored);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  clear() {
    this.map.clear();
  }
}

export class BodyCache {
  private readonly map = new Map<string, { body: Buffer; expires: number }>();
  private total = 0;
  constructor(
    private readonly budgetBytes = 32 * 1024 * 1024,
    private readonly ttlMs = 2 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}
  get(key: string): Buffer | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expires <= this.now()) {
      this.remove(key);
      return null;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.body;
  }
  set(key: string, body: Buffer): boolean {
    if (body.byteLength > this.budgetBytes) return false;
    this.remove(key);
    for (const [oldKey, entry] of Array.from(this.map)) {
      if (entry.expires <= this.now()) this.remove(oldKey);
    }
    while (this.total + body.byteLength > this.budgetBytes && this.map.size > 0) this.remove(this.map.keys().next().value as string);
    this.map.set(key, { body, expires: this.now() + this.ttlMs });
    this.total += body.byteLength;
    return true;
  }
  get bytes() {
    return this.total;
  }
  clear() {
    this.map.clear();
    this.total = 0;
  }
  private remove(key: string) {
    const entry = this.map.get(key);
    if (!entry) return;
    this.total -= entry.body.byteLength;
    this.map.delete(key);
  }
}

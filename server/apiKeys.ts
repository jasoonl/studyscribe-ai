import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { apiKeys, type ApiKey } from "../drizzle/schema";
import { getDb } from "./db";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { router, sessionProcedure } from "./_core/trpc";

/**
 * Personal API keys (E5).
 *
 * A key is `ssk_` followed by 32 random bytes (base64url). It is shown once;
 * only its SHA-256 hash is stored, so a database leak does not leak working
 * keys. SHA-256 (not bcrypt) is right here because the key is high-entropy
 * random, and the lookup must be by hash on every request.
 *
 * Scopes: "read" lists and reads; "write" also creates recordings from links
 * and generates notes. No scope reaches key management, billing or account
 * deletion: the REST API only routes to the procedures it lists, and those
 * procedures also refuse calls made with a key (`sessionProcedure`).
 */

export const API_KEY_PREFIX = "ssk_";
export const MAX_ACTIVE_KEYS = 10;
export type ApiScope = "read" | "write";

export function generateApiKey() {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export function hashApiKey(key: string) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Constant-time comparison of a presented key against a stored hash. */
export function apiKeyMatches(key: string, storedHash: string) {
  const given = Buffer.from(hashApiKey(key), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

/** A well-formed key: the prefix plus 43 base64url characters. Anything else is refused before a lookup. */
export function looksLikeApiKey(value: string) {
  return /^ssk_[A-Za-z0-9_-]{43}$/.test(value);
}

/** "write" includes "read". */
export function scopeAllows(granted: ApiScope, needed: ApiScope) {
  return granted === "write" || needed === "read";
}

/** Reads the key from `Authorization: Bearer ssk_…`. */
export function readBearerKey(header: string | undefined) {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

export async function findActiveKey(key: string): Promise<ApiKey | null> {
  if (!looksLikeApiKey(key)) return null;
  const db = await getDb();
  if (!db) return null;
  const hash = hashApiKey(key);
  const rows = await tolerateMissingSchema(
    "api keys",
    () => db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt))).limit(1),
    [] as ApiKey[],
  );
  const row = rows[0];
  return row && apiKeyMatches(key, row.keyHash) ? row : null;
}

/** Counts a request; the timestamp is written at most once a minute per key to keep writes low. */
export async function noteKeyUse(row: ApiKey, now = new Date()) {
  const db = await getDb();
  if (!db) return;
  const stale = !row.lastUsedAt || now.getTime() - new Date(row.lastUsedAt).getTime() > 60_000;
  await db
    .update(apiKeys)
    .set(stale ? { lastUsedAt: now, requestCount: sql`${apiKeys.requestCount} + 1` } : { requestCount: sql`${apiKeys.requestCount} + 1` })
    .where(eq(apiKeys.id, row.id))
    .catch(() => undefined);
}

function publicKey(row: ApiKey) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scope: row.scope,
    lastUsedAt: row.lastUsedAt,
    requestCount: row.requestCount,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}

export const apiKeysRouter = router({
  list: sessionProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await tolerateMissingSchema(
      "api keys",
      () => db.select().from(apiKeys).where(eq(apiKeys.userId, ctx.user.id)).orderBy(desc(apiKeys.createdAt)),
      null as ApiKey[] | null,
    );
    return { available: rows !== null, keys: (rows ?? []).map(publicKey) };
  }),

  /** Returns the key once. It cannot be shown again. */
  create: sessionProcedure
    .input(z.object({ name: z.string().trim().min(1).max(100), scope: z.enum(["read", "write"]) }))
    .mutation(async ({ ctx, input }) => {
      if (!checkTrpcRateLimit(`api-key-create:${ctx.user.id}`, 60 * 60 * 1000, 20)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many keys created. Try again in an hour." });
      }
      const db = await requireDb();
      return explainMissingSchema("API keys", async () => {
        const [{ count }] = await db
          .select({ count: sql<string>`COUNT(*)` })
          .from(apiKeys)
          .where(and(eq(apiKeys.userId, ctx.user.id), isNull(apiKeys.revokedAt)));
        if (Number(count) >= MAX_ACTIVE_KEYS) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `You can have ${MAX_ACTIVE_KEYS} active keys. Revoke one you no longer use first.` });
        }
        const generated = generateApiKey();
        await db.insert(apiKeys).values({ userId: ctx.user.id, name: input.name, prefix: generated.prefix, keyHash: generated.hash, scope: input.scope });
        return { key: generated.key, prefix: generated.prefix, scope: input.scope, name: input.name };
      });
    }),

  revoke: sessionProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await explainMissingSchema("API keys", () =>
      db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id), isNull(apiKeys.revokedAt))),
    );
    return { revoked: true };
  }),
});

export async function exportApiKeysForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await tolerateMissingSchema("api keys", () => db.select().from(apiKeys).where(eq(apiKeys.userId, userId)), [] as ApiKey[]);
  // Never the hash: it identifies a working key.
  return rows.map(publicKey);
}

export async function deleteApiKeysForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema("api keys", () => db.delete(apiKeys).where(eq(apiKeys.userId, userId)), undefined);
}

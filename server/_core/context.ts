import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getSessionFromCookie } from "../sessionManager";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * Set only when the public REST API (/api/v1, server/publicApi.ts) calls a
   * procedure on behalf of a personal API key. Session-only procedures (key
   * management, billing, account deletion) refuse such calls.
   */
  apiKey?: { id: number; scope: "read" | "write" } | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    // Try custom session first
    const session = getSessionFromCookie(opts.req.headers.cookie);
    if (session) {
      const db = await getDb();
      if (db) {
        const dbUser = await db
          .select()
          .from(users)
          .where(eq(users.id, session.userId))
          .limit(1);
        if (dbUser.length > 0) {
          user = dbUser[0];
        }
      }
    }

    // Custom auth only - no Manus OAuth fallback
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}

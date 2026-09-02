import crypto from "node:crypto";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { sql } from "drizzle-orm";
import { getDb } from "./db";

const INIT_TABLE = "_studyscribe_schema_init";

function tokensMatch(provided: string | undefined, expected: string | undefined) {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Registers a deliberately disabled-by-default, one-time schema initializer.
 * It is intended for the first TiDB deployment only; ordinary application
 * requests never run migrations.
 */
export function registerSchemaInitRoute(app: Express) {
  app.post("/api/admin/initialize-database", async (req: Request, res: Response) => {
    if (process.env.SCHEMA_INIT_ENABLED !== "true") {
      return res.status(404).json({ error: "Not found" });
    }

    if (!tokensMatch(req.header("x-schema-init-token"), process.env.SCHEMA_INIT_TOKEN)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const db = await getDb();
    if (!db) {
      return res.status(503).json({ error: "Database is not configured" });
    }

    try {
      await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS ${INIT_TABLE} (id TINYINT PRIMARY KEY, initialized_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`));
      const existing = await db.execute(sql.raw(`SELECT id FROM ${INIT_TABLE} WHERE id = 1 LIMIT 1`));
      const rows = Array.isArray(existing) ? existing[0] : [];
      if (Array.isArray(rows) && rows.length > 0) {
        return res.status(409).json({ error: "Database schema was already initialized" });
      }

      await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
      await db.execute(sql.raw(`INSERT INTO ${INIT_TABLE} (id) VALUES (1)`));
      return res.status(200).json({ status: "initialized" });
    } catch (error) {
      console.error("[Database] Schema initialization failed:", error);
      return res.status(500).json({ error: "Schema initialization failed" });
    }
  });
}

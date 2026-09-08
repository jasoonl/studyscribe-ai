import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { sql } from "drizzle-orm";
import { getDatabasePoolOptionsFromUrl, getDb, getExternalDatabaseConfig } from "./db";

const INIT_TABLE = "_studyscribe_schema_init";

function tokensMatch(provided: string | undefined, expected: string | undefined) {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function databaseEndpointMetadata() {
  const config = getExternalDatabaseConfig();
  if (!config) return null;
  if (config.kind === "tidb") {
    return { host: config.host, port: config.port, protocol: "mysql+tls" };
  }
  try {
    const parsed = new URL(config.url);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 3306,
      protocol: parsed.protocol.replace(":", ""),
    };
  } catch {
    return null;
  }
}

function configuredDatabaseName() {
  const config = getExternalDatabaseConfig();
  if (!config) return null;
  if (config.kind === "tidb") return config.database;
  try {
    return getDatabasePoolOptionsFromUrl(config.url).database || null;
  } catch {
    return null;
  }
}

function authorizeRequest(req: Request, res: Response) {
  if (process.env.SCHEMA_INIT_ENABLED !== "true") {
    res.status(404).json({ error: "Not found" });
    return false;
  }

  if (!tokensMatch(req.header("x-schema-init-token"), process.env.SCHEMA_INIT_TOKEN)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

/**
 * Registers a deliberately disabled-by-default, one-time schema initializer.
 * It is intended for the first TiDB deployment only; ordinary application
 * requests never run migrations.
 */
export function registerSchemaInitRoute(app: Express) {
  app.get("/api/admin/database-status", async (req: Request, res: Response) => {
    if (!authorizeRequest(req, res)) return;

    const db = await getDb();
    if (!db) {
      return res.status(503).json({ error: "Database is not configured" });
    }

    try {
      const result = await db.execute(sql.raw("SELECT DATABASE() AS database_name, CURRENT_USER() AS current_account, USER() AS connection_user"));
      const tableResult = await db.execute(sql.raw("SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY TABLE_NAME"));
      const userCountResult = await db.execute(sql.raw("SELECT COUNT(*) AS user_count FROM users"));
      const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
      const tableRows = Array.isArray(tableResult) && Array.isArray(tableResult[0]) ? tableResult[0] : [];
      const userCountRows = Array.isArray(userCountResult) && Array.isArray(userCountResult[0]) ? userCountResult[0] : [];
      const row = rows[0] as Record<string, unknown> | undefined;
      const tables = tableRows
        .map(value => (value as Record<string, unknown>).table_name)
        .filter((value): value is string => typeof value === "string");
      return res.status(200).json({
        status: "connected",
        configuredDatabase: configuredDatabaseName(),
        endpoint: databaseEndpointMetadata(),
        tables,
        migrationTablePresent: tables.includes("__drizzle_migrations"),
        userCount: Number((userCountRows[0] as Record<string, unknown> | undefined)?.user_count ?? 0),
        serverDatabase: row?.database_name ?? null,
        currentUser: row?.current_account ?? null,
        connectionUser: row?.connection_user ?? null,
      });
    } catch (error) {
      console.error("[Database] Status check failed:", error);
      return res.status(500).json({ error: "Database status check failed" });
    }
  });

  app.post("/api/admin/initialize-database", async (req: Request, res: Response) => {
    if (!authorizeRequest(req, res)) return;

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
      const cause = error && typeof error === "object" && "cause" in error
        ? (error as { cause?: { code?: string; errno?: number; sqlMessage?: string } }).cause
        : undefined;
      console.error("[Database] Schema initialization failed:", {
        code: cause?.code,
        errno: cause?.errno,
        sqlMessage: cause?.sqlMessage,
        configuredDatabase: configuredDatabaseName(),
        endpoint: databaseEndpointMetadata(),
      });
      return res.status(500).json({ error: "Schema initialization failed" });
    }
  });
}

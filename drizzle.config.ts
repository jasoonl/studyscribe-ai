import { defineConfig } from "drizzle-kit";

function resolveDatabaseUrl(): string {
  const getTiDbFields = (prefix: "TIDB" | "DB") => ({
    host: process.env[`${prefix}_HOST`]?.trim(),
    port: process.env[`${prefix}_PORT`],
    user: process.env[`${prefix}_USER`]?.trim() || process.env[`${prefix}_USERNAME`]?.trim(),
    password: process.env[`${prefix}_PASSWORD`],
    database: process.env[`${prefix}_DATABASE`]?.trim() || process.env[`${prefix}_DB_NAME`]?.trim(),
  });
  const tidbFields = getTiDbFields("TIDB");
  const dbFields = getTiDbFields("DB");
  const { host, port, user, password, database } = tidbFields.host || tidbFields.user || tidbFields.password || tidbFields.database
    ? tidbFields
    : dbFields;

  // TiDB Cloud's current Connect dialog supplies independent .env values.
  // These take precedence so migrations and the runtime use the same database.
  if (host || user || password || database) {
    if (!host || !user || !password || !database) {
      throw new Error("TIDB_HOST, TIDB_USER, TIDB_PASSWORD, and TIDB_DATABASE are all required for Drizzle migrations");
    }
    const url = new URL("mysql://tidb.local");
    url.hostname = host;
    url.port = port || "4000";
    url.username = user;
    url.password = password;
    url.pathname = `/${database}`;
    url.searchParams.set("ssl", JSON.stringify({ rejectUnauthorized: true }));
    return url.toString();
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run drizzle commands");
  }
  return connectionString;
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
});

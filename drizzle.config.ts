import { defineConfig } from "drizzle-kit";

function resolveDatabaseUrl(): string {
  const host = process.env.TIDB_HOST?.trim();
  const user = process.env.TIDB_USER?.trim();
  const password = process.env.TIDB_PASSWORD;
  const database = process.env.TIDB_DATABASE?.trim();

  // TiDB Cloud's current Connect dialog supplies independent .env values.
  // These take precedence so migrations and the runtime use the same database.
  if (host || user || password || database) {
    if (!host || !user || !password || !database) {
      throw new Error("TIDB_HOST, TIDB_USER, TIDB_PASSWORD, and TIDB_DATABASE are all required for Drizzle migrations");
    }
    const url = new URL("mysql://tidb.local");
    url.hostname = host;
    url.port = process.env.TIDB_PORT || "4000";
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

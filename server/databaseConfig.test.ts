import { afterEach, describe, expect, it, vi } from "vitest";
import { createPool } from "mysql2";
import { getDatabasePoolOptionsFromUrl, getDb, getExternalDatabaseConfig, normalizeAuthEmail } from "./db";

vi.mock("mysql2", () => ({
  createPool: vi.fn(() => ({
    end: vi.fn(),
    query: vi.fn(),
  })),
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn((input: unknown) => input),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("external database configuration", () => {
  it("normalizes email input for existing-account authentication lookups", () => {
    expect(normalizeAuthEmail("  Existing.User@Example.COM ")).toBe("existing.user@example.com");
  });

  it("prefers the complete TIDB-prefixed environment fields, redirects sys to test, and enforces TLS", () => {
    vi.stubEnv("DATABASE_URL", "mysql://stale.example/old");
    vi.stubEnv("TIDB_HOST", "gateway01.us-east-1.prod.aws.tidbcloud.com");
    vi.stubEnv("TIDB_PORT", "4000");
    vi.stubEnv("TIDB_USER", "prefix.root");
    vi.stubEnv("TIDB_PASSWORD", "provider-password");
    vi.stubEnv("TIDB_DATABASE", "sys");

    expect(getExternalDatabaseConfig()).toEqual({
      kind: "tidb",
      host: "gateway01.us-east-1.prod.aws.tidbcloud.com",
      port: 4000,
      user: "prefix.root",
      password: "provider-password",
      database: "test",
      ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    });
  });

  it("accepts TiDB Cloud's DB-prefixed .env names and redirects sys to test", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TIDB_HOST", "");
    vi.stubEnv("DB_HOST", "gateway01.us-east-1.prod.aws.tidbcloud.com");
    vi.stubEnv("DB_PORT", "4000");
    vi.stubEnv("DB_USERNAME", "prefix.root");
    vi.stubEnv("DB_PASSWORD", "provider-password");
    vi.stubEnv("DB_DATABASE", "sys");

    expect(getExternalDatabaseConfig()).toMatchObject({
      kind: "tidb",
      host: "gateway01.us-east-1.prod.aws.tidbcloud.com",
      user: "prefix.root",
      database: "test",
    });
  });

  it("uses DATABASE_URL where TiDB fields have not been configured", () => {
    vi.stubEnv("TIDB_HOST", "");
    vi.stubEnv("DB_HOST", "");
    vi.stubEnv("DATABASE_URL", "mysql://user:pass@example.com:3306/app");
    expect(getExternalDatabaseConfig()).toEqual({ kind: "url", url: "mysql://user:pass@example.com:3306/app" });
  });

  it("returns null rather than building a partial provider connection", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TIDB_HOST", "gateway.example");
    vi.stubEnv("TIDB_USER", "prefix.root");
    vi.stubEnv("TIDB_PASSWORD", "");
    vi.stubEnv("TIDB_DATABASE", "sys");
    expect(getExternalDatabaseConfig()).toBeNull();
  });

  it("falls back to DATABASE_URL when provider fields are incomplete", () => {
    vi.stubEnv("DATABASE_URL", "mysql://user:pass@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/test");
    vi.stubEnv("TIDB_HOST", "gateway01.us-east-1.prod.aws.tidbcloud.com");
    vi.stubEnv("TIDB_USER", "prefix.root");
    vi.stubEnv("TIDB_PASSWORD", "");
    vi.stubEnv("TIDB_DATABASE", "test");
    expect(getExternalDatabaseConfig()).toEqual({
      kind: "url",
      url: "mysql://user:pass@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/test",
    });
  });

  it("enforces TLS for a TiDB Cloud DATABASE_URL", () => {
    expect(getDatabasePoolOptionsFromUrl("mysql://prefix.root:p%40ss@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/test")).toEqual({
      host: "gateway01.us-east-1.prod.aws.tidbcloud.com",
      port: 4000,
      user: "prefix.root",
      password: "p@ss",
      database: "test",
      ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    });
  });

  it("redirects a TiDB Cloud URL pointed at the protected sys schema to test", () => {
    expect(getDatabasePoolOptionsFromUrl("mysql://prefix.root:p%40ss@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/sys")).toMatchObject({
      database: "test",
      ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    });
  });

  it("does not add TiDB-specific TLS options to generic MySQL URLs", () => {
    expect(getDatabasePoolOptionsFromUrl("mysql://user:pass@example.com:3306/app")).toEqual({
      host: "example.com",
      port: 3306,
      user: "user",
      password: "pass",
      database: "app",
    });
  });

  it("does not forward the internal kind discriminator to MySQL2", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TIDB_HOST", "gateway.example");
    vi.stubEnv("TIDB_PORT", "4000");
    vi.stubEnv("TIDB_USER", "prefix.root");
    vi.stubEnv("TIDB_PASSWORD", "provider-password");
    vi.stubEnv("TIDB_DATABASE", "sys");

    await getDb();

    expect(createPool).toHaveBeenCalledOnce();
    expect(createPool).toHaveBeenCalledWith({
      host: "gateway.example",
      port: 4000,
      user: "prefix.root",
      password: "provider-password",
      database: "test",
      ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    });
    expect((createPool as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).not.toHaveProperty("kind");
  });
});

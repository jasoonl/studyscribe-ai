import { afterEach, describe, expect, it, vi } from "vitest";
import { getExternalDatabaseConfig } from "./db";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("external database configuration", () => {
  it("prefers the complete TiDB Cloud environment fields and enforces TLS", () => {
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
      database: "sys",
      ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    });
  });

  it("uses DATABASE_URL where TiDB fields have not been configured", () => {
    vi.stubEnv("TIDB_HOST", "");
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
});

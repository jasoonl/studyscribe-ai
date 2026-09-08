import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";

vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  getExternalDatabaseConfig: vi.fn(() => null),
  getDatabasePoolOptionsFromUrl: vi.fn(),
}));

import { registerSchemaInitRoute } from "./schemaInit";
import { getDb, getExternalDatabaseConfig, getDatabasePoolOptionsFromUrl } from "./db";

const originalEnabled = process.env.SCHEMA_INIT_ENABLED;
const originalToken = process.env.SCHEMA_INIT_TOKEN;

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.SCHEMA_INIT_ENABLED;
  else process.env.SCHEMA_INIT_ENABLED = originalEnabled;
  if (originalToken === undefined) delete process.env.SCHEMA_INIT_TOKEN;
  else process.env.SCHEMA_INIT_TOKEN = originalToken;
});

async function request(path: string, token?: string, method = "POST") {
  const app = express();
  registerSchemaInitRoute(app);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: token ? { "x-schema-init-token": token } : undefined,
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe("schema initialization route", () => {
  it("is not discoverable unless explicitly enabled", async () => {
    delete process.env.SCHEMA_INIT_ENABLED;
    const response = await request("/api/admin/initialize-database");
    expect(response.status).toBe(404);
  });

  it("rejects an invalid token before touching the database", async () => {
    process.env.SCHEMA_INIT_ENABLED = "true";
    process.env.SCHEMA_INIT_TOKEN = "expected-token";
    const response = await request("/api/admin/initialize-database", "wrong-token");
    expect(response.status).toBe(401);
  });

  it("protects the non-destructive database status route with the same token", async () => {
    process.env.SCHEMA_INIT_ENABLED = "true";
    process.env.SCHEMA_INIT_TOKEN = "expected-token";
    const response = await request("/api/admin/database-status", "wrong-token", "GET");
    expect(response.status).toBe(401);
  });

  it("returns safe database identity metadata when the status query succeeds", async () => {
    process.env.SCHEMA_INIT_ENABLED = "true";
    process.env.SCHEMA_INIT_TOKEN = "expected-token";
    vi.mocked(getExternalDatabaseConfig).mockReturnValue({ kind: "url", url: "mysql://user:password@gateway01.tidbcloud.com:4000/test" });
    vi.mocked(getDatabasePoolOptionsFromUrl).mockReturnValue({
      host: "gateway01.tidbcloud.com",
      port: 4000,
      user: "user",
      password: "password",
      database: "test",
      ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    });
    vi.mocked(getDb).mockResolvedValueOnce({
      execute: vi.fn(async () => [[{
        database_name: "test",
        current_account: "root@%",
        connection_user: "root@127.0.0.1",
      }], []]),
    } as never);

    const response = await request("/api/admin/database-status", "expected-token", "GET");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "connected",
      serverDatabase: "test",
      currentUser: "root@%",
      connectionUser: "root@127.0.0.1",
      endpoint: { host: "gateway01.tidbcloud.com", port: 4000, protocol: "mysql" },
    });
  });

  it("authenticates with the securely injected schema token before checking database readiness", async () => {
    const configuredToken = process.env.SCHEMA_INIT_TOKEN;
    expect(configuredToken, "SCHEMA_INIT_TOKEN must be configured for this project").toBeTruthy();
    process.env.SCHEMA_INIT_ENABLED = "true";
    const response = await request("/api/admin/initialize-database", configuredToken);
    expect(response.status).toBe(503);
  });
});

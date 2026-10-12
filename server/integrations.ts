import { randomBytes } from "crypto";
import type { Express, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { integrationConnections } from "../drizzle/schema";
import { getNoteTemplate } from "@shared/noteTemplates";
import { getDb, getRecordingById, getStudyGuideById, getStudyNoteById } from "./db";
import { getSafeApplicationOrigin } from "./email";
import { markdownToHtml, markdownToNotionBlocks } from "./markdownExport";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { getSessionFromCookie } from "./sessionManager";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "./tokenCrypto";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * "Send to Notion" and "Send to Google Docs" for study notes and study guides
 * (E3). Each person connects their own account with OAuth:
 *  - Notion: a public integration (NOTION_CLIENT_ID / NOTION_CLIENT_SECRET).
 *    During authorization Notion asks which pages to share; new pages are
 *    created under one of those.
 *  - Google: the existing Google OAuth client (GOOGLE_CLIENT_ID /
 *    GOOGLE_CLIENT_SECRET, or GOOGLE_DRIVE_CLIENT_ID / _SECRET to use another
 *    one) with only the `drive.file` scope, which lets the app create files and
 *    see only the files it created. Docs are uploaded as HTML and converted.
 * Tokens are encrypted at rest (server/tokenCrypto.ts) and removed on
 * disconnect (Google's is also revoked). When a provider is not configured the
 * buttons say so instead of failing.
 */

export type IntegrationProvider = "notion" | "google_drive";
const PROVIDERS = ["notion", "google_drive"] as const;
const PATH_FOR: Record<IntegrationProvider, string> = { notion: "notion", google_drive: "google" };
const STATE_COOKIE = "studyscribe_integration_state";
const STATE_TTL_SECONDS = 10 * 60;
const HTTP_TIMEOUT_MS = 15_000;
const NOTION_VERSION = "2022-06-28";
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const DEFAULT_ENDPOINTS = {
  "notion-authorize": "https://api.notion.com/v1/oauth/authorize",
  "notion-api": "https://api.notion.com/v1",
  "google-authorize": "https://accounts.google.com/o/oauth2/v2/auth",
  "google-token": "https://oauth2.googleapis.com/token",
  "google-revoke": "https://oauth2.googleapis.com/revoke",
  "google-upload": "https://www.googleapis.com/upload/drive/v3/files",
  "google-drive": "https://www.googleapis.com/drive/v3",
} as const;
type EndpointName = keyof typeof DEFAULT_ENDPOINTS;

/**
 * Provider URLs. INTEGRATIONS_TEST_BASE_URL points every one of them at a mock
 * server (`<base>/<name>`) for local end-to-end testing; it is ignored in
 * production so a misplaced variable can never send tokens elsewhere.
 */
export function endpoint(name: EndpointName, env: NodeJS.ProcessEnv = process.env) {
  const override = env.NODE_ENV !== "production" ? env.INTEGRATIONS_TEST_BASE_URL?.trim().replace(/\/$/, "") : undefined;
  return override ? `${override}/${name}` : DEFAULT_ENDPOINTS[name];
}

export function notionCredentials(env: NodeJS.ProcessEnv = process.env) {
  const clientId = env.NOTION_CLIENT_ID?.trim();
  const clientSecret = env.NOTION_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function googleDriveCredentials(env: NodeJS.ProcessEnv = process.env) {
  const clientId = (env.GOOGLE_DRIVE_CLIENT_ID || env.GOOGLE_CLIENT_ID)?.trim();
  const clientSecret = (env.GOOGLE_DRIVE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET)?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function credentials(provider: IntegrationProvider) {
  return provider === "notion" ? notionCredentials() : googleDriveCredentials();
}

export function redirectUri(provider: IntegrationProvider, origin: string) {
  return `${origin}/api/integrations/${PATH_FOR[provider]}/callback`;
}

function stateSecret() {
  return process.env.JWT_SECRET || "default-dev-secret-change-in-production";
}

export function createOAuthState(data: { userId: number; provider: IntegrationProvider; origin: string; nonce: string }) {
  return jwt.sign(data, stateSecret(), { expiresIn: STATE_TTL_SECONDS });
}

export function readOAuthState(token: string): { userId: number; provider: IntegrationProvider; origin: string; nonce: string } | null {
  try {
    const data = jwt.verify(token, stateSecret()) as any;
    if (typeof data?.userId !== "number" || !PROVIDERS.includes(data.provider) || typeof data.nonce !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(provider: IntegrationProvider, clientId: string, origin: string, state: string) {
  if (provider === "notion") {
    const url = new URL(endpoint("notion-authorize"));
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("owner", "user");
    url.searchParams.set("redirect_uri", redirectUri(provider, origin));
    url.searchParams.set("state", state);
    return url.toString();
  }
  const url = new URL(endpoint("google-authorize"));
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(provider, origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_DRIVE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

async function http(url: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers as Record<string, string>) },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { ok: response.ok, status: response.status, body };
}

type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date | null; accountLabel: string | null };

async function exchangeCode(provider: IntegrationProvider, code: string, origin: string): Promise<Tokens> {
  const creds = credentials(provider);
  if (!creds) throw new Error("not configured");
  if (provider === "notion") {
    const result = await http(`${endpoint("notion-api")}/oauth/token`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`, "notion-version": NOTION_VERSION },
      json: { grant_type: "authorization_code", code, redirect_uri: redirectUri(provider, origin) },
    });
    if (!result.ok || !result.body?.access_token) throw new Error(`Notion did not accept the sign-in (${result.status}).`);
    return {
      accessToken: result.body.access_token,
      refreshToken: result.body.refresh_token ?? null,
      expiresAt: typeof result.body.expires_in === "number" ? new Date(Date.now() + result.body.expires_in * 1000) : null,
      accountLabel: result.body.workspace_name ?? null,
    };
  }
  const result = await http(endpoint("google-token"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri(provider, origin), grant_type: "authorization_code" }).toString(),
  });
  if (!result.ok || !result.body?.access_token) throw new Error(`Google did not accept the sign-in (${result.status}).`);
  if (typeof result.body.scope === "string" && !result.body.scope.split(" ").includes(GOOGLE_DRIVE_SCOPE)) {
    throw new Error("Google Drive access was not granted.");
  }
  let accountLabel: string | null = null;
  const about = await http(`${endpoint("google-drive")}/about?fields=user(emailAddress,displayName)`, { headers: { authorization: `Bearer ${result.body.access_token}` } }).catch(() => null);
  if (about?.ok) accountLabel = about.body?.user?.emailAddress ?? about.body?.user?.displayName ?? null;
  return {
    accessToken: result.body.access_token,
    refreshToken: result.body.refresh_token ?? null,
    expiresAt: typeof result.body.expires_in === "number" ? new Date(Date.now() + result.body.expires_in * 1000) : null,
    accountLabel,
  };
}

async function saveConnection(userId: number, provider: IntegrationProvider, tokens: Tokens) {
  const db = await requireDb();
  const values = {
    userId,
    provider,
    accessToken: encryptSecret(tokens.accessToken, "integration-token"),
    refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken, "integration-token") : null,
    expiresAt: tokens.expiresAt,
    accountLabel: tokens.accountLabel,
  };
  await db.insert(integrationConnections).values(values).onDuplicateKeyUpdate({
    set: {
      accessToken: values.accessToken,
      // Google sends a refresh token only on the first consent; keep the old one otherwise.
      ...(values.refreshToken ? { refreshToken: values.refreshToken } : {}),
      expiresAt: values.expiresAt,
      accountLabel: values.accountLabel,
    },
  });
}

async function loadConnection(userId: number, provider: IntegrationProvider) {
  const db = await requireDb();
  const [row] = await explainMissingSchema("Connected apps", () =>
    db.select().from(integrationConnections).where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, provider))).limit(1),
  );
  return row ?? null;
}

const NOT_CONNECTED = { notion: "Connect Notion in Settings first.", google_drive: "Connect Google Docs in Settings first." } as const;

/** A usable access token, refreshing Google's when it is about to expire. */
async function accessTokenFor(userId: number, provider: IntegrationProvider): Promise<string> {
  const row = await loadConnection(userId, provider);
  if (!row) throw new TRPCError({ code: "PRECONDITION_FAILED", message: NOT_CONNECTED[provider] });
  const accessToken = decryptSecret(row.accessToken, "integration-token");
  if (provider !== "google_drive" || !row.expiresAt || row.expiresAt.getTime() > Date.now() + 60_000) return accessToken;
  const creds = googleDriveCredentials();
  if (!row.refreshToken || !creds) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your Google connection expired. Reconnect it in Settings." });
  const result = await http(endpoint("google-token"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: decryptSecret(row.refreshToken, "integration-token"), grant_type: "refresh_token" }).toString(),
  });
  if (!result.ok || !result.body?.access_token) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your Google connection expired. Reconnect it in Settings." });
  const db = await requireDb();
  await db
    .update(integrationConnections)
    .set({ accessToken: encryptSecret(result.body.access_token, "integration-token"), expiresAt: new Date(Date.now() + (result.body.expires_in ?? 3600) * 1000) })
    .where(eq(integrationConnections.id, row.id));
  return result.body.access_token;
}

// ---------------------------------------------------------------- OAuth routes

function settingsRedirect(origin: string, provider: IntegrationProvider, status: "connected" | "error", reason?: string) {
  const url = new URL(`${origin}/settings`);
  url.searchParams.set("integration", PATH_FOR[provider]);
  url.searchParams.set("status", status);
  if (reason) url.searchParams.set("reason", reason);
  url.hash = "connected-apps";
  return url.toString();
}

function providerFromPath(value: string): IntegrationProvider | null {
  if (value === "notion") return "notion";
  if (value === "google") return "google_drive";
  return null;
}

export function registerIntegrationRoutes(app: Express) {
  app.get("/api/integrations/:provider/connect", (req: Request, res: Response) => {
    const provider = providerFromPath(req.params.provider);
    const origin = getSafeApplicationOrigin(typeof req.query.origin === "string" ? req.query.origin : undefined);
    if (!provider) {
      res.status(404).send("Unknown integration");
      return;
    }
    const session = getSessionFromCookie(req);
    if (!session) {
      res.redirect(`${origin}/login`);
      return;
    }
    const creds = credentials(provider);
    if (!creds || !isEncryptionConfigured()) {
      res.redirect(settingsRedirect(origin, provider, "error", "not_configured"));
      return;
    }
    const nonce = randomBytes(16).toString("base64url");
    const state = createOAuthState({ userId: session.userId, provider, origin, nonce });
    res.cookie(STATE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      maxAge: STATE_TTL_SECONDS * 1000,
      path: "/api/integrations",
    });
    res.redirect(buildAuthorizeUrl(provider, creds.clientId, origin, state));
  });

  app.get("/api/integrations/:provider/callback", async (req: Request, res: Response) => {
    const provider = providerFromPath(req.params.provider);
    if (!provider) {
      res.status(404).send("Unknown integration");
      return;
    }
    const state = typeof req.query.state === "string" ? readOAuthState(req.query.state) : null;
    const origin = getSafeApplicationOrigin(state?.origin);
    const cookieNonce = req.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1);
    res.clearCookie(STATE_COOKIE, { path: "/api/integrations" });
    const session = getSessionFromCookie(req);
    if (!state || state.provider !== provider || !cookieNonce || cookieNonce !== state.nonce || !session || session.userId !== state.userId) {
      res.redirect(settingsRedirect(origin, provider, "error", "state"));
      return;
    }
    if (typeof req.query.error === "string" || typeof req.query.code !== "string") {
      res.redirect(settingsRedirect(origin, provider, "error", "denied"));
      return;
    }
    try {
      const tokens = await exchangeCode(provider, req.query.code, origin);
      await saveConnection(state.userId, provider, tokens);
      res.redirect(settingsRedirect(origin, provider, "connected"));
    } catch (error) {
      console.error(`[integrations] ${provider} connect failed:`, error instanceof Error ? error.message : error);
      res.redirect(settingsRedirect(origin, provider, "error", "exchange"));
    }
  });
}

// ---------------------------------------------------------------- sending

type Exportable = { title: string; markdown: string };

async function loadExportable(userId: number, kind: "note" | "guide", id: number): Promise<Exportable> {
  if (kind === "note") {
    const note = await getStudyNoteById(id);
    if (!note || note.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
    const recording = await getRecordingById(note.recordingId);
    if (!recording || recording.isDeleted) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
    const template = getNoteTemplate((note.metadata as any)?.template);
    return { title: `${recording.title}: ${template?.label ?? "Notes"}`.slice(0, 200), markdown: note.content };
  }
  const guide = await getStudyGuideById(id);
  if (!guide || guide.userId !== userId) throw new TRPCError({ code: "NOT_FOUND", message: "Study guide not found" });
  return { title: guide.title.slice(0, 200), markdown: guide.content };
}

export async function createNotionPage(accessToken: string, parentPageId: string, doc: Exportable) {
  const blocks = markdownToNotionBlocks(doc.markdown);
  const headers = { authorization: `Bearer ${accessToken}`, "notion-version": NOTION_VERSION };
  const created = await http(`${endpoint("notion-api")}/pages`, {
    method: "POST",
    headers,
    json: { parent: { page_id: parentPageId }, properties: { title: { title: [{ type: "text", text: { content: doc.title } }] } }, children: blocks.slice(0, 100) },
  });
  if (!created.ok || !created.body?.id) {
    if (created.status === 401) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Notion no longer accepts this connection. Reconnect it in Settings." });
    throw new TRPCError({ code: "BAD_GATEWAY", message: created.body?.message ? `Notion said: ${created.body.message}` : `Notion could not create the page (${created.status}).` });
  }
  // Notion takes at most 100 blocks per request.
  for (let i = 100; i < blocks.length; i += 100) {
    const appended = await http(`${endpoint("notion-api")}/blocks/${created.body.id}/children`, { method: "PATCH", headers, json: { children: blocks.slice(i, i + 100) } });
    if (!appended.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "Notion created the page but stopped partway through. Open it to see what arrived." });
  }
  return { url: created.body.url as string | undefined };
}

export function buildMultipartUpload(metadata: object, html: string, boundary: string) {
  return [`--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(metadata), `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", html, `--${boundary}--`, ""].join("\r\n");
}

export async function createGoogleDoc(accessToken: string, doc: Exportable) {
  const boundary = `studyscribe-${randomBytes(8).toString("hex")}`;
  const body = buildMultipartUpload({ name: doc.title, mimeType: "application/vnd.google-apps.document" }, markdownToHtml(doc.markdown, doc.title), boundary);
  const result = await http(`${endpoint("google-upload")}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!result.ok || !result.body?.id) {
    if (result.status === 401) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Google no longer accepts this connection. Reconnect it in Settings." });
    throw new TRPCError({ code: "BAD_GATEWAY", message: `Google Docs could not create the document (${result.status}).` });
  }
  return { url: (result.body.webViewLink as string | undefined) ?? `https://docs.google.com/document/d/${result.body.id}/edit` };
}

export async function deleteIntegrationsForUser(userId: number) {
  const db = await requireDb();
  await tolerateMissingSchema("integrations", () => db.delete(integrationConnections).where(eq(integrationConnections.userId, userId)), undefined);
}

export async function exportIntegrationsForUser(userId: number) {
  const db = await requireDb();
  return tolerateMissingSchema(
    "integrations",
    async () =>
      (await db.select().from(integrationConnections).where(eq(integrationConnections.userId, userId))).map(row => ({
        provider: row.provider,
        accountLabel: row.accountLabel,
        connectedAt: row.createdAt,
      })),
    [] as Array<{ provider: string; accountLabel: string | null; connectedAt: Date }>,
  );
}

const providerInput = z.enum(PROVIDERS);

export const integrationsRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await tolerateMissingSchema(
      "integrations",
      () => db.select().from(integrationConnections).where(eq(integrationConnections.userId, ctx.user.id)),
      null as Array<typeof integrationConnections.$inferSelect> | null,
    );
    const describe = (provider: IntegrationProvider) => {
      const row = rows?.find(candidate => candidate.provider === provider);
      return {
        configured: !!credentials(provider) && isEncryptionConfigured(),
        connected: !!row,
        accountLabel: row?.accountLabel ?? null,
        connectedAt: row?.createdAt ?? null,
      };
    };
    return { available: rows !== null, notion: describe("notion"), google: describe("google_drive") };
  }),

  disconnect: protectedProcedure.input(z.object({ provider: providerInput })).mutation(async ({ input, ctx }) => {
    const row = await loadConnection(ctx.user.id, input.provider);
    if (!row) return { disconnected: true };
    if (input.provider === "google_drive") {
      // Best effort: the row goes either way, and Google expires unused tokens.
      try {
        const token = row.refreshToken ? decryptSecret(row.refreshToken, "integration-token") : decryptSecret(row.accessToken, "integration-token");
        await http(endpoint("google-revoke"), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString() });
      } catch (error) {
        console.warn("[integrations] Google revoke failed:", error instanceof Error ? error.message : error);
      }
    }
    const db = await requireDb();
    await db.delete(integrationConnections).where(eq(integrationConnections.id, row.id));
    return { disconnected: true };
  }),

  /** Pages the person shared with StudyScribe when connecting Notion; new pages go under one of them. */
  notionPages: protectedProcedure.query(async ({ ctx }) => {
    const token = await accessTokenFor(ctx.user.id, "notion");
    const result = await http(`${endpoint("notion-api")}/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "notion-version": NOTION_VERSION },
      json: { filter: { property: "object", value: "page" }, page_size: 50, sort: { direction: "descending", timestamp: "last_edited_time" } },
    });
    if (!result.ok) {
      if (result.status === 401) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Notion no longer accepts this connection. Reconnect it in Settings." });
      throw new TRPCError({ code: "BAD_GATEWAY", message: "Could not list your Notion pages right now." });
    }
    const pages = (result.body?.results ?? []).map((page: any) => {
      const titleProperty = Object.values(page.properties ?? {}).find((property: any) => property?.type === "title") as any;
      const title = (titleProperty?.title ?? []).map((part: any) => part.plain_text ?? part.text?.content ?? "").join("").trim();
      return { id: String(page.id), title: title || "Untitled" };
    });
    return { pages };
  }),

  send: protectedProcedure
    .input(z.object({ provider: providerInput, kind: z.enum(["note", "guide"]), id: z.number().int().positive(), notionParentId: z.string().min(8).max(64).optional() }))
    .mutation(async ({ input, ctx }) => {
      if (!checkTrpcRateLimit(`integration-send:${ctx.user.id}`, 60_000, 10)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Wait a moment before sending more." });
      if (!credentials(input.provider)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${input.provider === "notion" ? "Notion" : "Google Docs"} export is not set up on this server.` });
      const doc = await loadExportable(ctx.user.id, input.kind, input.id);
      const token = await accessTokenFor(ctx.user.id, input.provider);
      if (input.provider === "notion") {
        if (!input.notionParentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a Notion page to put it under." });
        return createNotionPage(token, input.notionParentId, doc);
      }
      return createGoogleDoc(token, doc);
    }),
});

import type { Express, NextFunction, Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { z } from "zod";
import { NOTE_TEMPLATES } from "@shared/noteTemplates";
import { TRANSCRIPTION_LANGUAGE_CODES } from "@shared/languages";
import type { ApiKey, User } from "../drizzle/schema";
import { findActiveKey, noteKeyUse, readBearerKey, scopeAllows, type ApiScope } from "./apiKeys";
import { getDb, getRecordingById } from "./db";
import { appRouter } from "./routers";
import { UsageLimitError } from "./usageRules";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Public REST API (E5), versioned under /api/v1.
 *
 * Every endpoint is a thin wrapper over an existing tRPC procedure, called
 * through `appRouter.createCaller` with the key's owner as the user, so the
 * same ownership checks, usage limits (transcription minutes and AI
 * generations count against the owner's plan) and side effects apply as in
 * the app. Only the procedures listed here are reachable; key management,
 * billing and account deletion are not, and also refuse key-authenticated
 * calls themselves (`sessionProcedure`).
 *
 * Errors are JSON: `{ "error": { "code": "not_found", "message": "…" } }`.
 * Rate limits are per key, in memory per server instance (like the app's
 * other limits): 60 requests a minute, of which at most 10 may create
 * recordings or generate notes.
 */

export const API_VERSION = "v1";
export const RATE_LIMITS = { requestsPerMinute: 60, writesPerMinute: 10 } as const;

type Window = { count: number; resetAt: number };

/** Fixed one-minute windows per key and bucket; returns the numbers for the X-RateLimit headers. */
export class KeyRateLimiter {
  private windows = new Map<string, Window>();
  constructor(private readonly windowMs = 60_000) {}

  check(key: string, limit: number, now = Date.now()) {
    let entry = this.windows.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, entry);
    }
    const allowed = entry.count < limit;
    if (allowed) entry.count += 1;
    if (this.windows.size > 10_000) this.prune(now);
    return { allowed, limit, remaining: Math.max(0, limit - entry.count), resetSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }

  private prune(now: number) {
    this.windows.forEach((entry, key) => {
      if (now >= entry.resetAt) this.windows.delete(key);
    });
  }
}

const limiter = new KeyRateLimiter();

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const TRPC_CODES: Record<string, string> = {
  BAD_REQUEST: "invalid_request",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  PRECONDITION_FAILED: "not_available",
  TOO_MANY_REQUESTS: "rate_limited",
  BAD_GATEWAY: "upstream_error",
  PAYLOAD_TOO_LARGE: "too_large",
};

const INTERNAL_MESSAGE = /sql|query|database|ER_[A-Z_]+|ECONN|ETIMEDOUT|ENOTFOUND|undefined|null|cannot read|is not a function|stack|token|secret|api key/i;

/** A short sentence without signs of an internal failure. */
export function isUserFacingMessage(message: string) {
  return message.length > 0 && message.length <= 300 && !INTERNAL_MESSAGE.test(message);
}

/** Maps anything a procedure throws to an HTTP status and a stable error code. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof z.ZodError) return new ApiError(400, "invalid_request", error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "));
  if (error instanceof TRPCError) {
    if (error.cause instanceof UsageLimitError) return new ApiError(402, "usage_limit", error.message);
    if (error.cause instanceof z.ZodError) return toApiError(error.cause);
    const status = getHTTPStatusCodeFromError(error);
    // Procedures throw plain Errors with sentences meant for people ("That link points to a
    // private address."); the app shows them, so the API does too. Database and runtime
    // errors stay hidden.
    const cause = error.cause;
    if (error.code === "INTERNAL_SERVER_ERROR" && cause instanceof Error && cause.constructor === Error && isUserFacingMessage(cause.message)) {
      return new ApiError(422, "request_failed", cause.message);
    }
    if (status >= 500) return new ApiError(status, TRPC_CODES[error.code] ?? "server_error", status === 500 ? "Something went wrong on our side." : error.message);
    return new ApiError(status, TRPC_CODES[error.code] ?? "error", error.message);
  }
  return new ApiError(500, "server_error", "Something went wrong on our side.");
}

type ApiContext = { key: ApiKey; user: User; req: Request; res: Response };

function caller(ctx: ApiContext) {
  return appRouter.createCaller({ req: ctx.req, res: ctx.res, user: ctx.user, apiKey: { id: ctx.key.id, scope: ctx.key.scope } });
}

function idParam(req: Request) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(404, "not_found", "Recording not found.");
  return id;
}

async function ownRecording(ctx: ApiContext, id: number) {
  const recording = await getRecordingById(id);
  if (!recording || recording.userId !== ctx.user.id || recording.isDeleted) throw new ApiError(404, "not_found", "Recording not found.");
  return recording;
}

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

export function publicRecording(row: { id: number; title: string; description: string | null; status: string | null; duration: number | null; audience: string | null; createdAt: Date; updatedAt: Date; courseId?: number | null; tagIds?: number[] }) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status ?? "processing",
    durationSeconds: row.duration && row.duration > 0 ? row.duration : null,
    audience: row.audience ?? "student",
    courseId: row.courseId ?? null,
    tagIds: row.tagIds ?? [],
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

type Handler = (ctx: ApiContext) => Promise<{ status?: number; body: unknown }>;

function endpoint(scope: ApiScope, kind: "read" | "write", handler: Handler) {
  return async (req: Request, res: Response) => {
    try {
      const token = readBearerKey(req.get("authorization"));
      if (!token) throw new ApiError(401, "unauthorized", "Send your API key as `Authorization: Bearer ssk_…`. Create one in Settings.");
      const key = await findActiveKey(token);
      if (!key) throw new ApiError(401, "unauthorized", "This API key is not valid or has been revoked.");

      const general = limiter.check(`all:${key.id}`, RATE_LIMITS.requestsPerMinute);
      res.setHeader("X-RateLimit-Limit", String(general.limit));
      res.setHeader("X-RateLimit-Remaining", String(general.remaining));
      res.setHeader("X-RateLimit-Reset", String(general.resetSeconds));
      if (!general.allowed) {
        res.setHeader("Retry-After", String(general.resetSeconds));
        throw new ApiError(429, "rate_limited", `This key is limited to ${RATE_LIMITS.requestsPerMinute} requests a minute. Try again in ${general.resetSeconds}s.`);
      }
      if (kind === "write") {
        const writes = limiter.check(`write:${key.id}`, RATE_LIMITS.writesPerMinute);
        if (!writes.allowed) {
          res.setHeader("Retry-After", String(writes.resetSeconds));
          throw new ApiError(429, "rate_limited", `This key can create or generate ${RATE_LIMITS.writesPerMinute} times a minute. Try again in ${writes.resetSeconds}s.`);
        }
      }
      if (!scopeAllows(key.scope, scope)) throw new ApiError(403, "insufficient_scope", "This key is read-only. Create a key with write access in Settings to do this.");

      const db = await getDb();
      if (!db) throw new ApiError(503, "unavailable", "The service is temporarily unavailable.");
      const [user] = await db.select().from(users).where(eq(users.id, key.userId)).limit(1);
      if (!user) throw new ApiError(401, "unauthorized", "This API key is not valid or has been revoked.");
      void noteKeyUse(key);

      const result = await handler({ key, user, req, res });
      res.status(result.status ?? 200).json(result.body);
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.status >= 500) console.error("[api] request failed:", error instanceof Error ? error.message : error);
      res.status(apiError.status).json({ error: { code: apiError.code, message: apiError.message } });
    }
  };
}

const listQuery = z.object({
  courseId: z.coerce.number().int().positive().optional(),
  status: z.enum(["processing", "completed", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createBody = z.object({
  url: z.string().url().max(2048),
  title: z.string().trim().min(1).max(255).optional(),
  language: z.enum(TRANSCRIPTION_LANGUAGE_CODES).optional(),
  audience: z.enum(["student", "professional"]).optional(),
});

const NOTE_TEMPLATE_IDS = NOTE_TEMPLATES.map((template) => template.id) as [string, ...string[]];
const notesBody = z.object({ template: z.enum(NOTE_TEMPLATE_IDS).optional() }).default({});

export function registerPublicApi(app: Express) {
  app.get("/api/v1", (_req, res) => {
    res.json({ version: API_VERSION, docs: "/developers" });
  });

  app.get("/api/v1/me", endpoint("read", "read", async (ctx) => {
    const status = await caller(ctx).billing.status();
    return {
      body: {
        id: ctx.user.id,
        name: ctx.user.name,
        email: ctx.user.email,
        plan: { id: status.plan.id, name: status.plan.name },
        usage: status.usage,
        key: { name: ctx.key.name, scope: ctx.key.scope },
      },
    };
  }));

  app.get("/api/v1/recordings", endpoint("read", "read", async (ctx) => {
    const query = listQuery.parse(ctx.req.query);
    const rows = await caller(ctx).recordings.list(query.courseId ? { courseId: query.courseId } : undefined);
    const filtered = rows
      .filter((row) => !query.status || row.status === query.status)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const page = filtered.slice(query.offset, query.offset + query.limit);
    return {
      body: {
        data: page.map(publicRecording),
        total: filtered.length,
        limit: query.limit,
        offset: query.offset,
        nextOffset: query.offset + page.length < filtered.length ? query.offset + page.length : null,
      },
    };
  }));

  app.post("/api/v1/recordings", endpoint("write", "write", async (ctx) => {
    const body = createBody.parse(ctx.req.body ?? {});
    const recording = await caller(ctx).recordings.createFromUrl({ url: body.url, title: body.title, language: body.language, audience: body.audience ?? "student" });
    return { status: 202, body: { data: publicRecording(recording) } };
  }));

  app.get("/api/v1/recordings/:id", endpoint("read", "read", async (ctx) => {
    const id = idParam(ctx.req);
    const recording = await ownRecording(ctx, id);
    const api = caller(ctx);
    // In polling mode this check is what moves a transcription forward, as the app's own pages do every few seconds.
    if (recording.status === "processing") await api.recordings.getStatus({ id });
    return { body: { data: publicRecording(await api.recordings.get({ id })) } };
  }));

  app.get("/api/v1/recordings/:id/transcript", endpoint("read", "read", async (ctx) => {
    const id = idParam(ctx.req);
    const recording = await ownRecording(ctx, id);
    const transcript = await caller(ctx).transcription.get({ recordingId: id });
    if (!transcript) {
      throw new ApiError(404, "not_found", recording.status === "processing" ? "The transcript is not ready yet. Check the recording's status again shortly." : "This recording has no transcript.");
    }
    return {
      body: {
        data: {
          recordingId: id,
          language: transcript.language,
          text: transcript.fullText,
          segments: (transcript.segments ?? []).map((segment) => ({ start: segment.start, end: segment.end, speaker: segment.speaker ?? null, text: segment.text })),
          updatedAt: iso(transcript.updatedAt),
        },
      },
    };
  }));

  app.get("/api/v1/recordings/:id/notes", endpoint("read", "read", async (ctx) => {
    const id = idParam(ctx.req);
    await ownRecording(ctx, id);
    const notes = await caller(ctx).ai.getStudyNotes({ recordingId: id });
    return {
      body: {
        data: notes.map((note) => ({ id: note.id, type: note.type, template: (note.metadata as any)?.template ?? null, content: note.content, createdAt: iso(note.createdAt) })),
      },
    };
  }));

  app.post("/api/v1/recordings/:id/notes", endpoint("write", "write", async (ctx) => {
    const id = idParam(ctx.req);
    const recording = await ownRecording(ctx, id);
    if (recording.status !== "completed") throw new ApiError(409, "not_ready", "Notes can be written once the transcript is ready.");
    const body = notesBody.parse(ctx.req.body ?? {});
    const api = caller(ctx);
    await api.ai.generateStudyNotes({ recordingId: id, template: body.template as any });
    const notes = await api.ai.getStudyNotes({ recordingId: id });
    const newest = [...notes].sort((a, b) => b.id - a.id)[0];
    return {
      status: 201,
      body: { data: newest ? { id: newest.id, type: newest.type, template: (newest.metadata as any)?.template ?? null, content: newest.content, createdAt: iso(newest.createdAt) } : null },
    };
  }));

  app.get("/api/v1/recordings/:id/flashcards", endpoint("read", "read", async (ctx) => {
    const id = idParam(ctx.req);
    await ownRecording(ctx, id);
    const cards = await caller(ctx).ai.getFlashcards({ recordingId: id });
    return { body: { data: cards.map((card) => ({ id: card.id, question: card.question, answer: card.answer, difficulty: card.difficulty, createdAt: iso(card.createdAt) })) } };
  }));

  // Anything else under /api/v1 is a JSON 404, not the SPA.
  app.use("/api/v1", (_req: Request, res: Response, _next: NextFunction) => {
    res.status(404).json({ error: { code: "not_found", message: "No such endpoint. See /developers for the list." } });
  });
}

import express, { type Express, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { meetingBots, users, type MeetingBot } from "../drizzle/schema";
import { findCalendarEvent } from "./calendar";
import { notifyUser } from "./collabNotifications";
import { createRecording, getDb, getRecordingsByUserId, updateRecordingStatus } from "./db";
import { probeAudioDuration } from "./audioDuration";
import { linkRecordingEvent, normalizeAttendees, parseStoredAttendees } from "./recordingEvents";
import {
  PLATFORM_LABELS,
  RecallApiError,
  buildCreateBotBody,
  getRecallConfig,
  isActiveBotStatus,
  isAllowedMediaUrl,
  latestStatusCode,
  mediaDownloadUrl,
  meetingPlatform,
  noteTakerName,
  parseRecallEvent,
  recallRequest,
  shouldApplyStatus,
  statusFromRecallCode,
  verifyRecallSignature,
  type MeetingPlatform,
  type RecallConfig,
} from "./recall";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { isVercelBlobStorageConfigured, putAudioStream, storagePut } from "./storage";
import { startTranscription } from "./transcriptionStart";
import { limitStreamSize, MAX_IMPORT_BYTES } from "./urlAudioImport";
import { assertCanTranscribe } from "./usage";
import { UsageLimitError } from "./usageRules";
import { checkTrpcRateLimit } from "./_core/rateLimit";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * "Send a note-taker" (A4): a Recall.ai bot joins a Zoom, Google Meet or
 * Teams call, says in its name and in the chat that it is recording, and
 * when the call is over its audio becomes a normal recording that goes
 * through the usual transcription pipeline.
 *
 * No request waits for a meeting. Recall's signed webhook moves the status
 * along; when it reports "done", the webhook copies the audio into storage
 * (a bounded download) and starts transcription. As a fallback, the page
 * listing note-takers polls, and each poll checks stale active bots with
 * Recall and imports a finished one; the daily cron sweeps the rest.
 * Recall's copy of the media is deleted once StudyScribe has it.
 */

export const MAX_ACTIVE_BOTS = 3;
const REFRESH_AFTER_MS = 20_000;
const SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60_000;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}

function requireConfig(): RecallConfig {
  const config = getRecallConfig();
  if (!config) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The meeting note-taker is not set up on this server yet." });
  return config;
}

function publicBot(row: MeetingBot) {
  return {
    id: row.id,
    title: row.title,
    platform: row.platform as MeetingPlatform,
    platformLabel: PLATFORM_LABELS[row.platform as MeetingPlatform] ?? row.platform,
    botName: row.botName,
    status: row.status,
    statusDetail: row.statusDetail,
    joinAt: row.joinAt,
    recordingId: row.recordingId,
    active: isActiveBotStatus(row.status),
    createdAt: row.createdAt,
  };
}

/** Moves a bot to a reported status unless that would go backwards (webhooks can be late or repeated). */
async function applyStatus(row: MeetingBot, code: string | null, at = 0) {
  const mapped = statusFromRecallCode(code);
  if (!mapped || !shouldApplyStatus(row.status, mapped.status)) return row;
  const db = await requireDb();
  await db
    .update(meetingBots)
    .set({ status: mapped.status, statusDetail: mapped.detail, lastEventAt: Math.max(row.lastEventAt, at), lastCheckedAt: new Date() })
    .where(eq(meetingBots.id, row.id));
  if (mapped.status === "failed") {
    await notifyUser(row.userId, { title: "The note-taker could not record", message: `${row.title}: ${mapped.detail ?? "Something went wrong."}`, url: "/dashboard", tag: `bot-${row.id}` });
  }
  return { ...row, status: mapped.status, statusDetail: mapped.detail };
}

/** Streams the bot's audio into storage; buffers it when only the legacy storage API is configured. */
async function storeMeetingAudio(userId: number, response: globalThis.Response) {
  const limited = limitStreamSize(response.body as ReadableStream<Uint8Array>, MAX_IMPORT_BYTES);
  const [upload, probe] = limited.tee();
  const contentLength = Number(response.headers.get("content-length")) || null;
  if (isVercelBlobStorageConfigured()) {
    const [stored, duration] = await Promise.all([putAudioStream({ userId, mimeType: "audio/mpeg", body: upload }), probeAudioDuration(probe, "audio/mpeg", contentLength)]);
    return { key: stored.key, url: stored.url, mimeType: stored.mimeType, duration };
  }
  const [buffer, duration] = await Promise.all([new globalThis.Response(upload).arrayBuffer(), probeAudioDuration(probe, "audio/mpeg", contentLength)]);
  const stored = await storagePut(`${userId}/recordings/${Date.now()}-${randomUUID().slice(0, 8)}.mp3`, Buffer.from(buffer), "audio/mpeg");
  return { key: stored.key, url: stored.url, mimeType: "audio/mpeg", duration };
}

/**
 * Copies a finished bot's audio into a new recording and starts
 * transcription. Claims the bot first (done -> importing in one conditional
 * update) so a webhook and a poll cannot both import it. On failure the bot
 * goes back to "done" and the next webhook retry, poll or daily sweep tries
 * again.
 */
export async function importBotRecording(row: MeetingBot, config: RecallConfig): Promise<"imported" | "skipped" | "waiting" | "failed"> {
  if (!row.recallBotId) return "skipped";
  const db = await requireDb();
  const claim: any = await db.update(meetingBots).set({ status: "importing", statusDetail: "Copying the recording" }).where(and(eq(meetingBots.id, row.id), eq(meetingBots.status, "done")));
  const claimed = (Array.isArray(claim) ? claim[0]?.affectedRows : claim?.affectedRows) === 1;
  if (!claimed) return "skipped";

  const release = (detail: string) => db.update(meetingBots).set({ status: "done", statusDetail: detail }).where(eq(meetingBots.id, row.id));
  try {
    const bot = await recallRequest(config, "GET", `/bot/${encodeURIComponent(row.recallBotId)}/`);
    const url = mediaDownloadUrl(bot);
    if (!url) {
      await release("Waiting for the recording to be ready");
      return "waiting";
    }
    if (!isAllowedMediaUrl(url, config)) throw new Error("Unexpected media location");
    const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok || !response.body) throw new Error(`Media download returned ${response.status}`);
    const stored = await storeMeetingAudio(row.userId, response);

    const [owner] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!owner) throw new Error("Owner not found");
    await createRecording({
      userId: row.userId,
      title: row.title,
      description: `Recorded by the StudyScribe note-taker in ${PLATFORM_LABELS[row.platform as MeetingPlatform] ?? "a meeting"}.`,
      audience: "professional",
      audioUrl: stored.url,
      audioKey: stored.key,
      duration: stored.duration ?? 0,
    });
    const recording = (await getRecordingsByUserId(row.userId)).find((candidate) => candidate.audioKey === stored.key);
    if (!recording) throw new Error("Recording was not created");

    await linkRecordingEvent({
      recordingId: recording.id,
      userId: row.userId,
      source: "meeting_bot",
      eventId: row.calendarEventId,
      title: row.title,
      startsAt: row.joinAt ?? row.createdAt,
      attendees: parseStoredAttendees(row.attendees),
    });
    await db.update(meetingBots).set({ status: "imported", statusDetail: null, recordingId: recording.id }).where(eq(meetingBots.id, row.id));
    // StudyScribe has its own copy now; Recall's is deleted.
    await recallRequest(config, "POST", `/bot/${encodeURIComponent(row.recallBotId)}/delete_media/`).catch((error) => {
      console.warn("[meetingBots] could not delete Recall's copy:", error instanceof Error ? error.message : error);
    });

    let overAllowance: string | null = null;
    try {
      await assertCanTranscribe(owner, stored.duration ?? 0);
    } catch (error) {
      if (!(error instanceof TRPCError && error.cause instanceof UsageLimitError)) throw error;
      overAllowance = error.message;
    }
    if (overAllowance) {
      await updateRecordingStatus(recording.id, "failed");
      await notifyUser(row.userId, { title: "Meeting recording saved, not transcribed", message: `${row.title}: ${overAllowance} Transcribe it from the recording page when your allowance allows.`, url: `/recording/${recording.id}`, recordingId: recording.id, tag: `bot-${row.id}` });
      return "imported";
    }
    await startTranscription(recording, stored.key, stored.mimeType).catch((error) => {
      console.error("[meetingBots] transcription did not start:", error instanceof Error ? error.message : error);
    });
    await notifyUser(row.userId, { title: "Your meeting recording is in", message: `${row.title} is being transcribed. You'll get another notification when the transcript is ready.`, url: `/recording/${recording.id}`, recordingId: recording.id, tag: `bot-${row.id}` });
    return "imported";
  } catch (error) {
    console.error("[meetingBots] import failed:", error instanceof Error ? error.message : error);
    await release("Could not copy the recording yet. Trying again shortly.");
    return "failed";
  }
}

/** Asks Recall for a bot's latest status (polling fallback), then imports it if it is done. */
async function refreshBot(row: MeetingBot, config: RecallConfig) {
  if (!row.recallBotId) return row;
  let current = row;
  if (current.status !== "done") {
    try {
      const bot = await recallRequest(config, "GET", `/bot/${encodeURIComponent(row.recallBotId)}/`);
      current = await applyStatus(row, latestStatusCode(bot));
    } catch (error) {
      if (error instanceof RecallApiError && error.status === 404) {
        current = await applyStatus(row, "fatal");
      } else {
        console.warn("[meetingBots] status check failed:", error instanceof Error ? error.message : error);
      }
    }
    const db = await requireDb();
    await db.update(meetingBots).set({ lastCheckedAt: new Date() }).where(eq(meetingBots.id, row.id));
  }
  if (current.status === "done") await importBotRecording(current, config);
  return current;
}

const sendInput = z.object({
  meetingUrl: z.string().trim().min(10).max(1024),
  title: z.string().trim().max(255).optional(),
  calendarEventId: z.string().min(1).max(255).optional(),
  /** The person confirmed they will tell everyone in the meeting it is being recorded. */
  consent: z.literal(true),
});

export const meetingBotsRouter = router({
  /** Whether the note-taker can be used here; the buttons explain it when not. */
  status: protectedProcedure.query(() => ({ configured: getRecallConfig() !== null, botName: null as string | null })),

  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await tolerateMissingSchema(
      "meeting bots",
      () => db.select().from(meetingBots).where(eq(meetingBots.userId, ctx.user.id)).orderBy(desc(meetingBots.createdAt)).limit(10),
      null as MeetingBot[] | null,
    );
    if (rows === null) return { available: false, bots: [] };
    const config = getRecallConfig();
    if (config) {
      // At most one stale bot is checked per request, so the poll stays quick.
      const stale = rows.find((row) => isActiveBotStatus(row.status) && row.status !== "importing" && (!row.lastCheckedAt || Date.now() - new Date(row.lastCheckedAt).getTime() > REFRESH_AFTER_MS) && (!row.joinAt || new Date(row.joinAt).getTime() - 60_000 < Date.now()));
      if (stale) {
        const updated = await refreshBot(stale, config);
        const index = rows.findIndex((row) => row.id === stale.id);
        const [fresh] = await db.select().from(meetingBots).where(eq(meetingBots.id, updated.id)).limit(1);
        if (fresh) rows[index] = fresh;
      }
    }
    return { available: true, bots: rows.map(publicBot) };
  }),

  send: protectedProcedure.input(sendInput).mutation(async ({ ctx, input }) => {
    const config = requireConfig();
    const platform = meetingPlatform(input.meetingUrl);
    if (!platform) throw new TRPCError({ code: "BAD_REQUEST", message: "Paste a Zoom, Google Meet or Microsoft Teams meeting link (starting with https://)." });
    if (!checkTrpcRateLimit(`meeting-bot:${ctx.user.id}`, 60 * 60 * 1000, 10)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many note-takers sent in the last hour. Try again later." });
    }
    await assertCanTranscribe(ctx.user, 0);
    const db = await requireDb();
    return explainMissingSchema("Meeting note-takers", async () => {
      const [{ count }] = await db
        .select({ count: sql<string>`COUNT(*)` })
        .from(meetingBots)
        .where(and(eq(meetingBots.userId, ctx.user.id), inArray(meetingBots.status, ["scheduled", "joining", "waiting_room", "in_call", "recording", "ended", "done", "importing"])));
      if (Number(count) >= MAX_ACTIVE_BOTS) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `You can have ${MAX_ACTIVE_BOTS} note-takers on their way at once. Wait for one to finish or cancel it.` });
      }

      const event = input.calendarEventId ? await findCalendarEvent(ctx.user.id, input.calendarEventId) : null;
      const now = Date.now();
      const eventStart = event && !event.allDay ? Date.parse(event.start) : null;
      // A future event gets a scheduled bot, a minute early; anything else joins now.
      const joinAt = eventStart && eventStart - 60_000 > now + 2 * 60_000 && eventStart - now < SCHEDULE_AHEAD_MS ? new Date(eventStart - 60_000) : null;
      const title = (input.title || event?.title || `${PLATFORM_LABELS[platform]} meeting`).slice(0, 255);
      const botName = noteTakerName(ctx.user.name);
      const attendees = normalizeAttendees(event?.attendees ?? [], ctx.user.email);

      const inserted: any = await db.insert(meetingBots).values({
        userId: ctx.user.id,
        meetingUrl: input.meetingUrl.trim(),
        platform,
        title,
        botName,
        status: "scheduled",
        statusDetail: joinAt ? "Scheduled" : "Sending",
        joinAt,
        calendarEventId: event?.id ?? null,
        attendees: attendees.length ? JSON.stringify(attendees) : null,
      });
      const rowId = Number(Array.isArray(inserted) ? inserted[0]?.insertId : inserted?.insertId);

      try {
        const bot = await recallRequest<{ id: string }>(config, "POST", "/bot/", buildCreateBotBody({ meetingUrl: input.meetingUrl.trim(), botName, personName: ctx.user.name, joinAt, botRowId: rowId, userId: ctx.user.id }));
        if (!bot?.id) throw new RecallApiError("Recall did not return a bot", 502);
        await db.update(meetingBots).set({ recallBotId: bot.id, statusDetail: joinAt ? "Scheduled" : "Joining soon" }).where(eq(meetingBots.id, rowId));
      } catch (error) {
        await db.delete(meetingBots).where(eq(meetingBots.id, rowId));
        console.error("[meetingBots] create failed:", error instanceof Error ? error.message : error);
        const message = error instanceof RecallApiError && error.status < 500 ? `The note-taker could not be sent: ${error.message}` : "The note-taker service did not answer. Nothing was sent; try again in a moment.";
        throw new TRPCError({ code: error instanceof RecallApiError && error.status < 500 ? "BAD_REQUEST" : "BAD_GATEWAY", message });
      }
      const [row] = await db.select().from(meetingBots).where(eq(meetingBots.id, rowId)).limit(1);
      return publicBot(row);
    });
  }),

  /** Before it joins: cancels it. In the call: makes it leave; what it recorded so far is still imported. */
  stop: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const config = requireConfig();
    const db = await requireDb();
    const [row] = await explainMissingSchema("Meeting note-takers", () => db.select().from(meetingBots).where(and(eq(meetingBots.id, input.id), eq(meetingBots.userId, ctx.user.id))).limit(1));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Note-taker not found" });
    if (!isActiveBotStatus(row.status) || ["ended", "done", "importing"].includes(row.status)) return { status: row.status };
    const notJoinedYet = row.status === "scheduled" || row.status === "joining" || row.status === "waiting_room";
    if (row.recallBotId) {
      try {
        if (notJoinedYet && row.joinAt && new Date(row.joinAt).getTime() > Date.now()) {
          await recallRequest(config, "DELETE", `/bot/${encodeURIComponent(row.recallBotId)}/`);
        } else {
          await recallRequest(config, "POST", `/bot/${encodeURIComponent(row.recallBotId)}/leave_call/`);
        }
      } catch (error) {
        if (!(error instanceof RecallApiError && (error.status === 404 || error.status === 400))) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: "Could not reach the note-taker service. Remove the bot from the call yourself, or try again." });
        }
      }
    }
    const status = notJoinedYet ? "cancelled" : row.status;
    await db.update(meetingBots).set(notJoinedYet ? { status: "cancelled", statusDetail: "Cancelled" } : { statusDetail: "Leaving the call" }).where(eq(meetingBots.id, row.id));
    return { status };
  }),

  /** Clears a finished, failed or cancelled note-taker from the list. */
  dismiss: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await explainMissingSchema("Meeting note-takers", () =>
      db.delete(meetingBots).where(and(eq(meetingBots.id, input.id), eq(meetingBots.userId, ctx.user.id), inArray(meetingBots.status, ["imported", "failed", "cancelled"]))),
    );
    return { dismissed: true };
  }),
});

/** POST /api/webhooks/recall: signature-verified status updates. Registered before the JSON parser. */
export function registerRecallWebhook(app: Express) {
  app.post("/api/webhooks/recall", express.raw({ type: () => true, limit: "1mb" }), async (req: Request, res: Response) => {
    const config = getRecallConfig();
    if (!config) {
      res.status(503).json({ error: "The meeting note-taker is not configured on this server." });
      return;
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : "", "utf8");
    const check = verifyRecallSignature(raw, req.headers, config.webhookSecret);
    if (!check.ok) {
      res.status(400).json({ error: `Signature ${check.reason}` });
      return;
    }
    let body: any;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    const event = parseRecallEvent(body);
    if (!event) {
      res.status(200).json({ received: true, ignored: true });
      return;
    }
    try {
      const db = await requireDb();
      let [row] = await db.select().from(meetingBots).where(eq(meetingBots.recallBotId, event.botId)).limit(1);
      if (!row) {
        // A status can arrive before the create call returned and the id was stored; the metadata names our row.
        const ourId = Number(body?.data?.bot?.metadata?.studyscribe_bot);
        if (Number.isInteger(ourId) && ourId > 0) {
          [row] = await db.select().from(meetingBots).where(eq(meetingBots.id, ourId)).limit(1);
          if (row && !row.recallBotId) await db.update(meetingBots).set({ recallBotId: event.botId }).where(eq(meetingBots.id, row.id));
          if (row && row.recallBotId && row.recallBotId !== event.botId) row = undefined as unknown as MeetingBot;
        }
      }
      if (!row) {
        // Not ours (another app on the same Recall account), or already dismissed.
        res.status(200).json({ received: true, unknown: true });
        return;
      }
      const updated = await applyStatus({ ...row, recallBotId: row.recallBotId ?? event.botId }, event.code, event.at);
      if (updated.status === "done") {
        const result = await importBotRecording(updated, config);
        // A failed copy answers 500 so Recall retries the delivery later.
        if (result === "failed") {
          res.status(500).json({ error: "Import failed; retry later." });
          return;
        }
      }
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("[meetingBots] webhook failed:", error instanceof Error ? error.message : error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });
}

/** Daily cron: retries imports that did not finish and checks bots nobody has looked at for an hour. */
export async function sweepMeetingBots(now = new Date()) {
  const config = getRecallConfig();
  const db = await getDb();
  if (!config || !db) return { checked: 0 };
  const rows = await tolerateMissingSchema(
    "meeting bots",
    () =>
      db
        .select()
        .from(meetingBots)
        .where(and(inArray(meetingBots.status, ["joining", "waiting_room", "in_call", "recording", "ended", "done", "importing"]), lte(meetingBots.updatedAt, new Date(now.getTime() - 60 * 60_000))))
        .limit(20),
    [] as MeetingBot[],
  );
  for (const row of rows) {
    // An import that died mid-way (the function was stopped) is released for another try.
    if (row.status === "importing") await db.update(meetingBots).set({ status: "done" }).where(eq(meetingBots.id, row.id));
    await refreshBot({ ...row, status: row.status === "importing" ? "done" : row.status }, config).catch(() => undefined);
  }
  return { checked: rows.length };
}

export async function exportMeetingBotsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await tolerateMissingSchema("meeting bots", () => db.select().from(meetingBots).where(eq(meetingBots.userId, userId)), [] as MeetingBot[]);
  return rows.map((row) => ({ title: row.title, platform: row.platform, meetingUrl: row.meetingUrl, status: row.status, joinAt: row.joinAt, recordingId: row.recordingId, attendees: parseStoredAttendees(row.attendees), createdAt: row.createdAt }));
}

/** Account deletion: bots still on their way are called off first (best effort), then the rows go. */
export async function deleteMeetingBotsForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  const rows = await tolerateMissingSchema("meeting bots", () => db.select().from(meetingBots).where(eq(meetingBots.userId, userId)), [] as MeetingBot[]);
  const config = getRecallConfig();
  for (const row of rows) {
    if (!config || !row.recallBotId) continue;
    if (isActiveBotStatus(row.status)) {
      await recallRequest(config, row.status === "scheduled" ? "DELETE" : "POST", row.status === "scheduled" ? `/bot/${encodeURIComponent(row.recallBotId)}/` : `/bot/${encodeURIComponent(row.recallBotId)}/leave_call/`).catch(() => undefined);
    }
    await recallRequest(config, "POST", `/bot/${encodeURIComponent(row.recallBotId)}/delete_media/`).catch(() => undefined);
  }
  await tolerateMissingSchema("meeting bots", () => db.delete(meetingBots).where(eq(meetingBots.userId, userId)), undefined);
}

/** When a recording made by a bot is purged, the bot row no longer points at it. */
export async function detachBotsFromRecordings(recordingIds: number[]) {
  if (!recordingIds.length) return;
  const db = await getDb();
  if (!db) return;
  await tolerateMissingSchema("meeting bots", () => db.update(meetingBots).set({ recordingId: null }).where(inArray(meetingBots.recordingId, recordingIds)), undefined);
}

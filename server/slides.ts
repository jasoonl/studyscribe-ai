import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { recordingSlides, recordings, type RecordingSlide } from "../drizzle/schema";
import { MAX_SLIDE_BYTES, MAX_SLIDES_PER_RECORDING, SLIDE_MAX_EDGE } from "@shared/slides";
import { getDb, getRecordingById } from "./db";
import { getRecordingAccess, requireRecordingAccess } from "./recordingAccess";
import { explainMissingSchema, tolerateMissingSchema } from "./schemaTolerance";
import { getVerifiedSession } from "./sessionUser";
import { safeEqual } from "./_core/secrets";
import { deleteStoredAudio, getBlobUsage, isObjectStorageConfigured, storageGetSignedUrl, storagePut } from "./storage";
import { protectedProcedure, router } from "./_core/trpc";

/**
 * Slides captured while recording a shared tab or screen (A6). The browser
 * decides which frames to keep (shared/slides.ts) and uploads them one at a
 * time after the recording is saved; this module checks and stores them,
 * serves them to people who can open the recording, and removes them with it.
 *
 * Storage (Vercel Blob, 1GB on Hobby) is the binding limit, so each image is
 * capped in bytes and size, a recording holds at most 40, and new slides are
 * refused while the store is over 90% full.
 */

/** Width and height from a JPEG's start-of-frame marker, or null when it is not a JPEG. */
export function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

export function decodeSlideImage(base64: string): { buffer: Buffer; width: number; height: number } {
  const data = base64.replace(/^data:image\/jpeg;base64,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new TRPCError({ code: "BAD_REQUEST", message: "Slides must be JPEG images." });
  const buffer = Buffer.from(data, "base64");
  if (buffer.length === 0 || buffer.length > MAX_SLIDE_BYTES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `A slide image must be under ${Math.round(MAX_SLIDE_BYTES / 1024)}KB.` });
  }
  const size = jpegDimensions(buffer);
  if (!size) throw new TRPCError({ code: "BAD_REQUEST", message: "Slides must be JPEG images." });
  // A little slack for rounding in the browser's scaling.
  if (Math.max(size.width, size.height) > SLIDE_MAX_EDGE + 8) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Slides can be at most ${SLIDE_MAX_EDGE} pixels on their long edge.` });
  }
  return { buffer, ...size };
}

const STORAGE_HEADROOM = 0.9;
let storageCheck: { at: number; room: boolean } | null = null;

/** Whether storage has room for more slides; asked at most every five minutes, since listing the store is slow. */
export async function storageHasRoomForSlides(now = Date.now()) {
  if (!isObjectStorageConfigured()) return true;
  if (storageCheck && now - storageCheck.at < 5 * 60 * 1000) return storageCheck.room;
  try {
    const usage = await getBlobUsage();
    // Unmetered (R2): no measured usage to compare against, so there is always room.
    if (!usage.metered) {
      storageCheck = { at: now, room: true };
      return true;
    }
    storageCheck = { at: now, room: usage.totalBytes < usage.limitBytes * STORAGE_HEADROOM };
  } catch (error) {
    console.warn("[slides] storage usage check failed:", error instanceof Error ? error.message : error);
    storageCheck = { at: now, room: true };
  }
  return storageCheck.room;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}

function publicSlide(row: RecordingSlide) {
  return { id: row.id, atSeconds: row.atSeconds, width: row.width, height: row.height, url: `/api/slides/${row.id}` };
}

export async function listSlides(recordingId: number) {
  const db = await getDb();
  if (!db) return [];
  return tolerateMissingSchema(
    "slides",
    () => db.select().from(recordingSlides).where(eq(recordingSlides.recordingId, recordingId)).orderBy(asc(recordingSlides.atSeconds), asc(recordingSlides.id)),
    [] as RecordingSlide[],
  );
}

export const slidesRouter = router({
  /** Anyone who can open the recording sees its slides. */
  list: protectedProcedure.input(z.object({ recordingId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await requireRecordingAccess(input.recordingId, ctx.user.id, "view");
    return (await listSlides(input.recordingId)).map(publicSlide);
  }),

  /** Whether new slides can be stored right now; the record pages ask before uploading. */
  capacity: protectedProcedure.query(async () => ({ room: await storageHasRoomForSlides(), maxPerRecording: MAX_SLIDES_PER_RECORDING })),

  add: protectedProcedure
    .input(z.object({
      recordingId: z.number().int().positive(),
      atSeconds: z.number().min(0).max(24 * 60 * 60),
      imageBase64: z.string().min(16).max(Math.ceil((MAX_SLIDE_BYTES * 4) / 3) + 64),
    }))
    .mutation(async ({ ctx, input }) => {
      const recording = await getRecordingById(input.recordingId);
      if (!recording || recording.userId !== ctx.user.id || recording.isDeleted) throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
      const image = decodeSlideImage(input.imageBase64);
      const db = await requireDb();
      return explainMissingSchema("Slides", async () => {
        const [{ count }] = await db.select({ count: sql<string>`COUNT(*)` }).from(recordingSlides).where(eq(recordingSlides.recordingId, recording.id));
        if (Number(count) >= MAX_SLIDES_PER_RECORDING) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `A recording keeps at most ${MAX_SLIDES_PER_RECORDING} slides.` });
        }
        if (!(await storageHasRoomForSlides())) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage is nearly full, so slides were not saved. The recording itself is safe." });
        }
        // A neutral key and type, like audio; the image is served as JPEG by /api/slides/:id.
        const stored = await storagePut(`${ctx.user.id}/slides/${recording.id}-${randomUUID()}.bin`, image.buffer, "application/octet-stream");
        try {
          await db.insert(recordingSlides).values({
            recordingId: recording.id,
            userId: ctx.user.id,
            atSeconds: Math.round(input.atSeconds),
            storageKey: stored.key,
            width: image.width,
            height: image.height,
            bytes: image.buffer.length,
          });
        } catch (error) {
          await deleteStoredAudio([stored.key]).catch(() => undefined);
          throw error;
        }
        return { saved: true };
      });
    }),

  remove: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [row] = await explainMissingSchema("Slides", () => db.select().from(recordingSlides).where(and(eq(recordingSlides.id, input.id), eq(recordingSlides.userId, ctx.user.id))).limit(1));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Slide not found" });
    await deleteStoredAudio([row.storageKey]);
    await db.delete(recordingSlides).where(eq(recordingSlides.id, row.id));
    return { removed: true };
  }),
});

/** GET /api/slides/:id: the image, for the owner, people it is shared with, or a public link's token. */
export function registerSlideRoutes(app: Express) {
  app.get("/api/slides/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(404).send("Not found");
      return;
    }
    try {
      const db = await getDb();
      if (!db) {
        res.status(503).send("Unavailable");
        return;
      }
      const [slide] = await tolerateMissingSchema("slides", () => db.select().from(recordingSlides).where(eq(recordingSlides.id, id)).limit(1), [] as RecordingSlide[]);
      if (!slide) {
        res.status(404).send("Not found");
        return;
      }
      const session = await getVerifiedSession(req);
      const token = typeof req.query.token === "string" ? req.query.token : "";
      let allowed = false;
      if (session) allowed = Boolean(await getRecordingAccess(slide.recordingId, session.userId));
      if (!allowed && token) {
        const [recording] = await db.select({ token: recordings.publicShareToken, isDeleted: recordings.isDeleted }).from(recordings).where(eq(recordings.id, slide.recordingId)).limit(1);
        allowed = Boolean(recording && !recording.isDeleted && safeEqual(token, recording.token));
      }
      if (!allowed) {
        res.status(session ? 403 : 401).send("You do not have access to this slide");
        return;
      }
      const upstream = await fetch(await storageGetSignedUrl(slide.storageKey));
      if (!upstream.ok) {
        res.status(502).send("Slide storage is temporarily unavailable");
        return;
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("Content-Length", String(body.length));
      res.status(200).end(body);
    } catch (error) {
      console.error("[slides] read failed:", error instanceof Error ? error.message : error);
      res.status(502).send("Slide storage is temporarily unavailable");
    }
  });
}

/** For purgeRecordings: the stored images go first (a failure stops the purge), then the rows. */
export async function deleteSlidesForRecordings(recordingIds: number[]) {
  if (recordingIds.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const rows = await tolerateMissingSchema(
    "slides",
    () => db.select({ id: recordingSlides.id, storageKey: recordingSlides.storageKey }).from(recordingSlides).where(inArray(recordingSlides.recordingId, recordingIds)),
    [] as Array<{ id: number; storageKey: string }>,
  );
  if (rows.length === 0) return;
  await deleteStoredAudio(rows.map((row) => row.storageKey));
  await db.delete(recordingSlides).where(inArray(recordingSlides.recordingId, recordingIds));
}

export async function exportSlidesForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await tolerateMissingSchema("slides", () => db.select().from(recordingSlides).where(eq(recordingSlides.userId, userId)), [] as RecordingSlide[]);
  return rows.map((row) => ({ recordingId: row.recordingId, atSeconds: row.atSeconds, width: row.width, height: row.height, bytes: row.bytes, createdAt: row.createdAt }));
}

/** Account deletion: slides of recordings already purged are gone; this catches any left over. */
export async function deleteSlidesForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  const rows = await tolerateMissingSchema("slides", () => db.select({ storageKey: recordingSlides.storageKey }).from(recordingSlides).where(eq(recordingSlides.userId, userId)), [] as Array<{ storageKey: string }>);
  if (rows.length) await deleteStoredAudio(rows.map((row) => row.storageKey));
  await tolerateMissingSchema("slides", () => db.delete(recordingSlides).where(eq(recordingSlides.userId, userId)), undefined);
}

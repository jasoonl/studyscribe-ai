import type { Express } from "express";
import { ENV } from "./env";
import { Readable, Transform } from "node:stream";
import { getVerifiedSession } from "../sessionUser";
import { safeEqual } from "./secrets";
import { getRecordingByAudioKey } from "../db";
import { getRecordingAccess } from "../recordingAccess";
import { handleUploadPresigned } from "@vercel/blob/client";
import { createDirectAudioUpload, issueLargeUploadToken, isObjectStorageConfigured, contentTypeFromStorageKey, storageGetSignedUrl } from "../storage";
import { verifyTranscriptionAudioToken } from "../transcriptionAudioLink";
import { BodyCache, RangeSupportMemory, audioEtag, etagMatches } from "./audioProxyCache";
import { TRANSFER_PAUSED_MESSAGE, isTransferLimitReached, isTransferSoftCapReached, recordTransfer } from "../blobTransfer";

/** Largest object we're willing to buffer in order to answer a range ourselves. */
const RANGE_FALLBACK_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Browsers may reuse a played recording for ten minutes without asking again
 * and revalidate with If-None-Match afterwards. `private` keeps shared caches
 * out, and access is checked on every request that reaches this server.
 */
const AUDIO_CACHE_CONTROL = "private, max-age=600";

/** Per-process memory: does Blob honor Range for this key, and a bounded copy of objects it did not. */
export const rangeSupport = new RangeSupportMemory();
export const fullBodyCache = new BodyCache(RANGE_FALLBACK_MAX_BYTES);

function parseByteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;

  if (rawStart === "" && rawEnd === "") return null;
  // A suffix range ("bytes=-500") asks for the final N bytes.
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(start) || start >= size || end < start) return null;
  return { start, end };
}

/** Answers a Range (or a plain GET) from a whole object held in memory. */
function sendFromBuffer(res: import("express").Response, buffer: Buffer, rangeHeader: string | undefined): number {
  if (!rangeHeader) {
    res.status(200);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", String(buffer.byteLength));
    res.end(buffer);
    return buffer.byteLength;
  }
  const range = parseByteRange(rangeHeader, buffer.byteLength);
  if (!range) {
    res.status(416);
    res.setHeader("Content-Range", `bytes */${buffer.byteLength}`);
    res.end();
    return 0;
  }
  const slice = buffer.subarray(range.start, range.end + 1);
  res.status(206);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${buffer.byteLength}`);
  res.setHeader("Content-Length", String(slice.byteLength));
  res.end(slice);
  return slice.byteLength;
}

/** Pipes a web stream to the response, counting bytes and stopping the upstream if the client goes away. */
function pipeCounted(res: import("express").Response, body: ReadableStream, onDone: (bytes: number) => void, skip = 0, take = Infinity) {
  let seen = 0;
  let sent = 0;
  const source = Readable.fromWeb(body as never);
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      const chunkStart = seen;
      seen += chunk.length;
      if (seen <= skip) return cb();
      const from = Math.max(0, skip - chunkStart);
      const room = take - sent;
      const piece = chunk.subarray(from, from + Math.min(room, chunk.length - from));
      sent += piece.length;
      cb(null, piece);
      if (sent >= take) {
        // Everything asked for has been sent; stop reading (and paying for) the rest.
        source.destroy();
        this.end();
      }
    },
  });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    source.destroy();
    onDone(seen);
  };
  res.on("close", finish);
  source.on("error", () => {
    counter.end();
  });
  source.pipe(counter).pipe(res);
  return { sent: () => sent };
}

/**
 * Streams a stored object to the client with the real audio content type and
 * full byte-range semantics. Media elements expect range support — Safari in
 * particular sends `Range: bytes=0-1` before it will play anything and
 * refuses the source outright if the server does not honor it — and relaying
 * ranges also keeps each response under the serverless response size limit
 * for long recordings.
 *
 * Transfer is the scarce resource (Vercel Blob's free plan allows 10 GB a
 * month), so: browsers may cache the response and revalidate with a 304 that
 * never touches Blob; we remember per key whether Blob honored Range; and when
 * it ignores Range, a small object is fetched once and answered from memory
 * while a large one is streamed only as far as the requested range needs.
 * Callers must have checked access before calling.
 */
export async function streamStoredAudio(req: import("express").Request, res: import("express").Response, key: string) {
  const etag = audioEtag(key);
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", AUDIO_CACHE_CONTROL);
  res.setHeader("Vary", "Cookie, Authorization");

  if (etagMatches(req.headers["if-none-match"], etag)) {
    res.status(304).end();
    return;
  }

  let rangeHeader = req.headers.range;
  const ifRange = req.headers["if-range"];
  if (rangeHeader && typeof ifRange === "string" && ifRange.replace(/^W\//, "") !== etag) rangeHeader = undefined;

  const setTypeHeaders = () => {
    res.setHeader("Content-Type", contentTypeFromStorageKey(key));
    res.setHeader("X-Content-Type-Options", "nosniff");
  };

  const cached = fullBodyCache.get(key);
  if (cached) {
    setTypeHeaders();
    recordTransfer({ served: sendFromBuffer(res, cached, rangeHeader) }, { flush: true });
    return;
  }

  // Blob is known to ignore Range for this object: don't ask it for a slice.
  const knownIgnoring = Boolean(rangeHeader) && rangeSupport.get(key) === false;
  const signedUrl = await storageGetSignedUrl(key);
  const upstream = await fetch(signedUrl, rangeHeader && !knownIgnoring ? { headers: { Range: rangeHeader } } : undefined);

  if (upstream.status !== 200 && upstream.status !== 206) {
    console.error(`[StorageProxy] signed read for ${key} returned ${upstream.status}`);
    res.removeHeader("ETag");
    res.setHeader("Cache-Control", "no-store");
    res.status(502).send("Recording storage is temporarily unavailable");
    return;
  }

  setTypeHeaders();
  if (rangeHeader && upstream.status === 206) rangeSupport.set(key, true);

  // If a Range was asked for but storage answered with the whole object,
  // satisfying it here keeps the contract we advertise honest. Safari treats
  // a 200 reply to a ranged media request as non-seekable and can refuse the
  // source outright, so silently relaying it is not an option.
  if (rangeHeader && upstream.status === 200) {
    rangeSupport.set(key, false);
    const declared = Number(upstream.headers.get("content-length") ?? NaN);
    if (!Number.isFinite(declared) || declared <= RANGE_FALLBACK_MAX_BYTES) {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      recordTransfer({ fetched: buffer.byteLength });
      if (buffer.byteLength <= RANGE_FALLBACK_MAX_BYTES) fullBodyCache.set(key, buffer);
      recordTransfer({ served: sendFromBuffer(res, buffer, rangeHeader) }, { flush: true });
      return;
    }
    // Too large to hold: stream just far enough to cover the requested range.
    const range = parseByteRange(rangeHeader, declared);
    if (range && upstream.body) {
      res.status(206);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${declared}`);
      res.setHeader("Content-Length", String(range.end - range.start + 1));
      const piped = pipeCounted(res, upstream.body, (fetched) => recordTransfer({ fetched, served: piped.sent() }, { flush: true }), range.start, range.end - range.start + 1);
      return;
    }
    if (!range) {
      await upstream.body?.cancel().catch(() => undefined);
      res.status(416);
      res.setHeader("Content-Range", `bytes */${declared}`);
      res.end();
      return;
    }
  }

  res.status(upstream.status);
  res.setHeader("Accept-Ranges", "bytes");
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) res.setHeader("Content-Length", contentLength);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) res.setHeader("Content-Range", contentRange);

  if (!upstream.body) {
    res.end();
    return;
  }
  const piped = pipeCounted(res, upstream.body, (fetched) => recordTransfer({ fetched, served: piped.sent() }, { flush: true }));
}

type StoredRecording = { id: number; userId: number; isDeleted?: number | boolean | null; publicShareToken?: string | null };

/**
 * Who may read a recording's audio: its owner, anyone it is shared with
 * (direct or group, any role, through `getRecordingAccess`), or a visitor with
 * the public link's token (compared in constant time, and never for a recording
 * in the trash).
 */
export async function mayReadRecordingAudio(recording: StoredRecording, session: { userId: number } | null, shareToken: string): Promise<boolean> {
  if (session && recording.userId === session.userId) return true;
  if (shareToken && !recording.isDeleted && safeEqual(shareToken, recording.publicShareToken)) return true;
  return Boolean(session && (await getRecordingAccess(recording.id, session.userId)));
}

export function registerStorageProxy(app: Express) {
  app.post("/api/storage/upload-url", async (req, res) => {
    const session = await getVerifiedSession(req);
    if (!session) {
      res.status(401).json({ error: "Sign in to upload recordings" });
      return;
    }

    try {
      const upload = await createDirectAudioUpload({
        userId: session.userId,
        fileName: typeof req.body?.fileName === "string" ? req.body.fileName : "recording.webm",
        mimeType: typeof req.body?.mimeType === "string" ? req.body.mimeType : "",
        size: Number(req.body?.size),
      });
      if (!upload) {
        res.status(409).json({ enabled: false });
        return;
      }
      res.status(200).json({ enabled: true, upload });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not prepare upload";
      res.status(400).json({ error: message });
    }
  });

  // Token endpoint for the browser's multipart uploader (files too large for a single PUT).
  app.post("/api/storage/upload-presigned", async (req, res) => {
    const session = await getVerifiedSession(req);
    if (!session) {
      res.status(401).json({ error: "Sign in to upload recordings" });
      return;
    }
    try {
      const result = await handleUploadPresigned({
        request: req as never,
        body: req.body,
        getSignedToken: async (pathname, clientPayload) => {
          const payload = JSON.parse(clientPayload || "{}");
          return issueLargeUploadToken({ userId: session.userId, pathname, size: Number(payload.size) });
        },
      });
      res.status(200).json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Could not prepare upload" });
    }
  });

  app.get("/api/storage", async (req, res) => {
    if (!isObjectStorageConfigured()) {
      res.status(404).send("External storage is not configured");
      return;
    }
    const key = typeof req.query.key === "string" ? req.query.key : "";
    const shareToken = typeof req.query.token === "string" ? req.query.token : "";
    const session = await getVerifiedSession(req);
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    try {
      const recording = await getRecordingByAudioKey(key);
      if (!recording) {
        res.status(404).send("Recording not found");
        return;
      }

      // Playback has to work for everyone the recording is legitimately
      // shared with, not just its owner: a public share link carries a token
      // and has no session at all, and a direct recipient has a session but
      // does not own the row (a direct share or a study group share, at any role).
      if (!(await mayReadRecordingAudio(recording, session, shareToken))) {
        res.status(session ? 403 : 401).send("You do not have access to this recording");
        return;
      }
      // Soft cap: keep the owner's own playback going until the hard limit,
      // but stop serving everyone else before Vercel suspends the store.
      const isOwner = Boolean(session && recording.userId === session.userId);
      if (isOwner ? await isTransferLimitReached() : await isTransferSoftCapReached()) {
        res.status(503).setHeader("Retry-After", "86400");
        res.send(TRANSFER_PAUSED_MESSAGE);
        return;
      }
      await streamStoredAudio(req, res, key);
    } catch (error) {
      console.error("[StorageProxy] private Blob read failed:", error);
      res.status(502).send("Recording storage is temporarily unavailable");
    }
  });

  /**
   * Fetch target handed to the transcription provider. Authorization is the
   * signed token in the path, so this must not require a session — the
   * provider is an anonymous third party. Unlike the raw storage URL, this
   * ends in a real audio extension and serves the real content type, which
   * is what lets the provider identify the format.
   */
  app.get("/api/transcription-audio/:token/:filename", async (req, res) => {
    const key = verifyTranscriptionAudioToken(req.params.token);
    if (!key) {
      res.status(403).send("This transcription link is invalid or has expired");
      return;
    }

    try {
      await streamStoredAudio(req, res, key);
    } catch (error) {
      console.error("[StorageProxy] transcription audio read failed:", error);
      res.status(502).send("Recording storage is temporarily unavailable");
    }
  });

  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      // Same rule as /api/storage: keys are guessable (user id and a timestamp),
      // so the key alone must never be enough to read someone's audio.
      const recording = await getRecordingByAudioKey(key);
      if (!recording) {
        res.status(404).send("Not found");
        return;
      }
      const session = await getVerifiedSession(req);
      const shareToken = typeof req.query.token === "string" ? req.query.token : "";
      if (!(await mayReadRecordingAudio(recording, session, shareToken))) {
        res.status(session ? 403 : 401).send("You do not have access to this recording");
        return;
      }

      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

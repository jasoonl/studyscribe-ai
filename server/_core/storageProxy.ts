import type { Express } from "express";
import { ENV } from "./env";
import { Readable } from "node:stream";
import { getSessionFromCookie } from "../sessionManager";
import { getRecordingByAudioKey, getRecordingShareForUser } from "../db";
import { createDirectAudioUpload, isVercelBlobStorageConfigured, contentTypeFromStorageKey, storageGetSignedUrl } from "../storage";
import { verifyTranscriptionAudioToken } from "../transcriptionAudioLink";

/** Largest object we're willing to buffer in order to answer a range ourselves. */
const RANGE_FALLBACK_MAX_BYTES = 32 * 1024 * 1024;

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

/**
 * Answers a Range request from a full 200 body when storage ignored the
 * header. Returns false when it declines (too large to buffer), leaving the
 * caller to stream the full response instead.
 */
async function serveRangeFromFullBody(
  _req: unknown,
  res: import("express").Response,
  upstream: Response,
  rangeHeader: string,
): Promise<boolean> {
  const declaredLength = Number(upstream.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declaredLength) && declaredLength > RANGE_FALLBACK_MAX_BYTES) {
    await upstream.body?.cancel().catch(() => undefined);
    return false;
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (buffer.byteLength > RANGE_FALLBACK_MAX_BYTES) return false;

  const range = parseByteRange(rangeHeader, buffer.byteLength);
  if (!range) {
    res.status(416);
    res.setHeader("Content-Range", `bytes */${buffer.byteLength}`);
    res.end();
    return true;
  }

  const slice = buffer.subarray(range.start, range.end + 1);
  res.status(206);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${buffer.byteLength}`);
  res.setHeader("Content-Length", String(slice.byteLength));
  res.end(slice);
  return true;
}

/**
 * Streams a stored object to the client with the real audio content type and
 * full byte-range semantics. Media elements expect range support — Safari in
 * particular sends `Range: bytes=0-1` before it will play anything and
 * refuses the source outright if the server does not honor it — and relaying
 * ranges also keeps each response under the serverless response size limit
 * for long recordings.
 */
async function streamStoredAudio(req: import("express").Request, res: import("express").Response, key: string) {
  const signedUrl = await storageGetSignedUrl(key);
  const rangeHeader = req.headers.range;
  const upstream = await fetch(signedUrl, rangeHeader ? { headers: { Range: rangeHeader } } : undefined);

  if (upstream.status !== 200 && upstream.status !== 206) {
    console.error(`[StorageProxy] signed read for ${key} returned ${upstream.status}`);
    res.status(502).send("Recording storage is temporarily unavailable");
    return;
  }

  res.setHeader("Content-Type", contentTypeFromStorageKey(key));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache");

  // If a Range was asked for but storage answered with the whole object,
  // satisfying it here keeps the contract we advertise honest. Safari treats
  // a 200 reply to a ranged media request as non-seekable and can refuse the
  // source outright, so silently relaying it is not an option.
  if (rangeHeader && upstream.status === 200) {
    const served = await serveRangeFromFullBody(req, res, upstream, rangeHeader);
    if (served) return;
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
  Readable.fromWeb(upstream.body as never).pipe(res);
}

export function registerStorageProxy(app: Express) {
  app.post("/api/storage/upload-url", async (req, res) => {
    const session = getSessionFromCookie(req);
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

  app.get("/api/storage", async (req, res) => {
    if (!isVercelBlobStorageConfigured()) {
      res.status(404).send("External storage is not configured");
      return;
    }
    const key = typeof req.query.key === "string" ? req.query.key : "";
    const shareToken = typeof req.query.token === "string" ? req.query.token : "";
    const session = getSessionFromCookie(req);
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
      // does not own the row.
      const isOwner = Boolean(session && recording.userId === session.userId);
      const hasValidPublicToken = Boolean(
        shareToken && recording.publicShareToken && recording.publicShareToken === shareToken,
      );
      const isSharedRecipient = Boolean(
        session && !isOwner && (await getRecordingShareForUser(recording.id, session.userId)),
      );

      if (!isOwner && !hasValidPublicToken && !isSharedRecipient) {
        res.status(session ? 403 : 401).send("You do not have access to this recording");
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

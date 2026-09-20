import type { Express } from "express";
import { ENV } from "./env";
import { Readable } from "node:stream";
import { getSessionFromCookie } from "../sessionManager";
import { getRecordingByAudioKey, getRecordingShareForUser } from "../db";
import { createDirectAudioUpload, isVercelBlobStorageConfigured, contentTypeFromStorageKey, storageGetSignedUrl } from "../storage";

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
      // Relay the read from a short-lived signed URL rather than reading the
      // whole object into the function. Media elements expect byte-range
      // support — Safari in particular sends `Range: bytes=0-1` before it
      // will play anything and refuses the source outright if the server
      // does not honor it — and passing the client's Range header straight
      // through also keeps each response well under the serverless response
      // size limit for long recordings.
      const signedUrl = await storageGetSignedUrl(key);
      const rangeHeader = req.headers.range;
      const upstream = await fetch(signedUrl, rangeHeader ? { headers: { Range: rangeHeader } } : undefined);

      if (upstream.status !== 200 && upstream.status !== 206) {
        console.error(`[StorageProxy] signed read for ${key} returned ${upstream.status}`);
        res.status(502).send("Recording storage is temporarily unavailable");
        return;
      }

      res.status(upstream.status);
      res.setHeader("Content-Type", contentTypeFromStorageKey(key));
      res.setHeader("Accept-Ranges", "bytes");
      const contentLength = upstream.headers.get("content-length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      const contentRange = upstream.headers.get("content-range");
      if (contentRange) res.setHeader("Content-Range", contentRange);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-cache");

      if (!upstream.body) {
        res.end();
        return;
      }
      Readable.fromWeb(upstream.body as never).pipe(res);
    } catch (error) {
      console.error("[StorageProxy] private Blob read failed:", error);
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

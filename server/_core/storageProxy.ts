import type { Express } from "express";
import { ENV } from "./env";
import { get as getVercelBlob } from "@vercel/blob";
import { Readable } from "node:stream";
import { getSessionFromCookie } from "../sessionManager";
import { getRecordingByAudioKeyForUser } from "../db";
import { createDirectAudioUpload, isVercelBlobStorageConfigured } from "../storage";

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
    const session = getSessionFromCookie(req);
    if (!key || !session) {
      res.status(401).send("Sign in to access this recording");
      return;
    }

    try {
      const recording = await getRecordingByAudioKeyForUser(key, session.userId);
      if (!recording) {
        res.status(404).send("Recording not found");
        return;
      }
      const result = await getVercelBlob(key, { access: "private" });
      if (!result || result.statusCode !== 200 || !result.stream) {
        res.status(404).send("Recording file not found");
        return;
      }
      res.setHeader("Content-Type", result.blob.contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-cache");
      Readable.fromWeb(result.stream as never).pipe(res);
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

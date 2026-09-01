import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import express, { type Express } from "express";
import { pathToFileURL } from "node:url";
import { createApp } from "./app";
import { resumeProcessingRecordings } from "../routers";

export function serveProductionClient(app: Express) {
  const possiblePaths = [
    path.resolve(import.meta.dirname, "public"),
    path.resolve(process.cwd(), "dist/public"),
    "/app/dist/public",
  ];
  const distPath = possiblePaths.find(fs.existsSync) ?? possiblePaths[0];

  app.use(express.static(distPath));
  app.use("*", (req, res) => {
    if (req.originalUrl.startsWith("/api/") || req.originalUrl.startsWith("/manus-storage/") || req.originalUrl === "/healthz") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

export function startStandaloneServer() {
  const app = createApp();
  serveProductionClient(app);
  const port = Number.parseInt(process.env.PORT || "3000", 10);

  createServer(app).listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    resumeProcessingRecordings().catch(error => {
      console.error("[Transcription] Startup recovery unavailable:", error);
    });
  });
}

export function isDirectNodeExecution(moduleUrl: string) {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint && moduleUrl === pathToFileURL(entryPoint).href);
}

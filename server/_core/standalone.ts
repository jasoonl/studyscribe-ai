import { createServer } from "http";
import fs from "fs";
import path from "path";
import express from "express";
import { createApp } from "./app";
import { resumeProcessingRecordings } from "../routers";

function serveProductionClient(app: express.Express) {
  const possiblePaths = [
    path.resolve(import.meta.dirname, "public"),
    path.resolve(process.cwd(), "dist/public"),
    "/app/dist/public",
  ];
  const distPath = possiblePaths.find(fs.existsSync) ?? possiblePaths[0];

  app.use(express.static(distPath));
  app.use("*", (req, res) => {
    if (req.originalUrl.startsWith("/api/") || req.originalUrl.startsWith("/manus-storage/")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

const app = createApp();
serveProductionClient(app);
const port = Number.parseInt(process.env.PORT || "3000", 10);

createServer(app).listen(port, () => {
  console.log(`Server running on http://localhost:${port}/`);
  resumeProcessingRecordings().catch(error => {
    console.error("[Transcription] Startup recovery unavailable:", error);
  });
});

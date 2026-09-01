import { createServer } from "http";
import net from "net";
import { createApp } from "./app";
import { setupVite } from "./vite";
import { resumeProcessingRecordings } from "../routers";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => server.close(() => resolve(true)));
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startDevelopmentServer() {
  const app = createApp();
  const server = createServer(app);
  await setupVite(app, server);

  const preferredPort = Number.parseInt(process.env.PORT || "3000", 10);
  const port = await findAvailablePort(preferredPort);
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    resumeProcessingRecordings().catch(error => {
      console.error("[Transcription] Startup recovery unavailable:", error);
    });
  });
}

startDevelopmentServer().catch(console.error);

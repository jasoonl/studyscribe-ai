import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerAuthRoutes } from "../authRoutes";
import { appRouter, resumeProcessingRecordings } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

export function createApp() {
  const app = express();
  
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Platform health checks stay lightweight and independent of external providers.
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  registerStorageProxy(app);
  registerAuthRoutes(app);
  registerOAuthRoutes(app);
  
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    const server = createServer(app);
    setupVite(app, server).catch(console.error);
  } else {
    serveStatic(app);
  }
  
  return app;
}

// For local development: start the server and listen on a port
async function startServer() {
  const app = createApp();
  const server = createServer(app);
  
  const preferredPort = parseInt(process.env.PORT || "3000", 10);
  // Managed production hosts require the exact injected PORT; local development may avoid collisions.
  const port = process.env.NODE_ENV === "production"
    ? preferredPort
    : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Resume any uploads left in processing after a redeploy or process restart.
    resumeProcessingRecordings().catch((error) => {
      console.error("[Transcription] Startup recovery unavailable:", error);
    });
  });
}

// Only start the server if this is not being imported as a module (i.e., in local dev)
if (process.env.NODE_ENV === "development" || !process.env.VERCEL) {
  startServer().catch(console.error);
}

// Export the app for Vercel Serverless Functions
export default createApp();

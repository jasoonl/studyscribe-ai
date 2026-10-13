import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerYouTubeRelayRoutes } from "../youtubeRelay";
import { registerAuthRoutes } from "../authRoutes";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { handleAssemblyAiWebhook } from "../transcriptionWebhook";
import { registerSchemaInitRoute } from "../schemaInit";
import { registerFollowUpCron } from "../followUps";
import { registerIntegrationRoutes } from "../integrations";
import { registerStripeWebhook } from "../billing";
import { registerMobileRoutes } from "../mobileAuth";

/**
 * Builds the API-only Express application. This module must remain independent
 * of Vite and static-serving tooling so it can be imported by Vercel functions.
 */
export function createApp() {
  const app = express();

  // Vercel puts exactly one reverse proxy in front of the function, so trust
  // that one hop's X-Forwarded-For — otherwise req.ip resolves to Vercel's
  // internal address for every request, and per-IP rate limiting below would
  // either throttle everyone as one client or no one at all.
  app.set("trust proxy", 1);

  registerYouTubeRelayRoutes(app);
  // Before the JSON parser: Stripe signs the raw bytes.
  registerStripeWebhook(app);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/api/webhooks/assemblyai", handleAssemblyAiWebhook);
  // Mobile app (F1): before the auth routes, whose login/signup it wraps.
  registerMobileRoutes(app);
  registerSchemaInitRoute(app);
  registerFollowUpCron(app);
  registerStorageProxy(app);
  registerAuthRoutes(app);
  registerOAuthRoutes(app);
  registerIntegrationRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  return app;
}

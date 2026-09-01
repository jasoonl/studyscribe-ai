import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerAuthRoutes } from "../authRoutes";
import { appRouter } from "../routers";
import { createContext } from "./context";

/**
 * Builds the API-only Express application. This module must remain independent
 * of Vite and static-serving tooling so it can be imported by Vercel functions.
 */
export function createApp() {
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  registerStorageProxy(app);
  registerAuthRoutes(app);
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  return app;
}

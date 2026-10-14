import { createTRPCReact, httpBatchLink, type CreateTRPCReact } from "@trpc/react-query";
import { TRPCClientError } from "@trpc/client";
import superjson from "superjson";
// Type-only: nothing from the server is bundled into the app.
import type { AppRouter } from "../../../server/routers";
import { apiUrl } from "./config";

export type { AppRouter };

export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();

/**
 * tRPC client with the session token as a bearer header and superjson, as on
 * the web (client/src/main.tsx), so Dates and Maps arrive as they were sent.
 */
export function createTrpcClient(getToken: () => string | null, fetchImpl?: typeof fetch) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: apiUrl("/api/trpc"),
        transformer: superjson,
        headers() {
          const token = getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }),
    ],
  });
}

/** True when the API refused the request because the session is gone. */
export function isUnauthorized(error: unknown) {
  return error instanceof TRPCClientError && (error.data?.code === "UNAUTHORIZED" || error.data?.httpStatus === 401);
}

/** The message to show for a failed request: the server's own words when it gave any. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (error instanceof TRPCClientError) {
    if (error.data?.code === "UNAUTHORIZED") return "Your session ended. Sign in again.";
    if (/Failed to fetch|Network request failed/i.test(error.message)) return "Can't reach StudyScribe. Check your connection.";
    if (error.data?.zodError) return fallback;
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

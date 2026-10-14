import type { NextFunction, Request, Response } from "express";

/**
 * Cross-site request guard for the cookie-session REST endpoints under
 * /api/auth (login, sign-up, logout, password reset, resending the
 * confirmation email). The session cookie is SameSite=Lax, which keeps it off
 * cross-site POSTs, but these endpoints *set* the cookie or act without one:
 * a hidden form on another site could sign a visitor into the attacker's
 * account ("login CSRF") or fire reset emails. Browsers label every request
 * with Sec-Fetch-Site and Origin, so a POST another site started is refused.
 * Requests without either header (curl, the mobile app, server-to-server)
 * pass, since no browser is involved.
 */
export function isCrossSiteRequest(req: Pick<Request, "headers">, host: string | undefined): boolean {
  const fetchSite = req.headers["sec-fetch-site"];
  if (typeof fetchSite === "string") return fetchSite === "cross-site";
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin === "") return false;
  if (origin === "null") return true; // sandboxed iframes and data: URLs
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export function rejectCrossSitePosts(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const host = typeof req.headers["x-forwarded-host"] === "string" ? req.headers["x-forwarded-host"].split(",")[0].trim() : req.headers.host;
  if (isCrossSiteRequest(req, host)) {
    res.status(403).json({ error: "This request came from another site and was refused." });
    return;
  }
  next();
}

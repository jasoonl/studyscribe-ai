/**
 * SAML sign-in through WorkOS (F3), over its REST API with no SDK.
 *
 * On only when WORKOS_API_KEY and WORKOS_CLIENT_ID are set. A team uses it
 * once the app's admin links the team to a WorkOS organisation (Admin page)
 * and the team's IT admin connects their identity provider in WorkOS's
 * Admin Portal (a link from the team console). Sign-in then goes:
 * /api/auth/sso/start (finds the team by the email's verified domain) ->
 * WorkOS -> the identity provider -> /api/auth/sso/callback, which exchanges
 * the code for a profile and checks it belongs to that team's WorkOS
 * organisation and domain. WORKOS_API_BASE points at a local mock outside
 * production only.
 */

const DEFAULT_BASE = "https://api.workos.com";

export type WorkosConfig = { apiKey: string; clientId: string; apiBase: string };

export function getWorkosConfig(env: NodeJS.ProcessEnv = process.env): WorkosConfig | null {
  const apiKey = env.WORKOS_API_KEY?.trim();
  const clientId = env.WORKOS_CLIENT_ID?.trim();
  if (!apiKey || !clientId) return null;
  const override = env.NODE_ENV !== "production" ? env.WORKOS_API_BASE?.trim().replace(/\/$/, "") : undefined;
  return { apiKey, clientId, apiBase: override || DEFAULT_BASE };
}

export function isWorkosConfigured(env: NodeJS.ProcessEnv = process.env) {
  return getWorkosConfig(env) !== null;
}

export function describeWorkosConfig(env: NodeJS.ProcessEnv = process.env) {
  const origin = (env.PUBLIC_APP_URL || env.APP_URL || "").replace(/\/$/, "");
  return {
    configured: isWorkosConfigured(env),
    apiKey: Boolean(env.WORKOS_API_KEY?.trim()),
    clientId: Boolean(env.WORKOS_CLIENT_ID?.trim()),
    redirectUri: origin ? `${origin}/api/auth/sso/callback` : null,
  };
}

export function ssoAuthorizeUrl(config: WorkosConfig, input: { organization: string; redirectUri: string; state: string; loginHint?: string }) {
  const url = new URL(`${config.apiBase}/sso/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("organization", input.organization);
  url.searchParams.set("state", input.state);
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

export type WorkosProfile = { id: string; email: string; firstName: string | null; lastName: string | null; organizationId: string | null };

export async function exchangeSsoCode(config: WorkosConfig, code: string): Promise<WorkosProfile> {
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.apiKey, grant_type: "authorization_code", code });
  const response = await fetch(`${config.apiBase}/sso/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  const json: any = await response.json().catch(() => null);
  if (!response.ok || !json?.profile) throw new Error(json?.error_description || json?.message || `WorkOS returned ${response.status}`);
  const profile = json.profile;
  return {
    id: String(profile.id ?? ""),
    email: String(profile.email ?? "").trim().toLowerCase(),
    firstName: typeof profile.first_name === "string" ? profile.first_name : null,
    lastName: typeof profile.last_name === "string" ? profile.last_name : null,
    organizationId: typeof profile.organization_id === "string" ? profile.organization_id : null,
  };
}

export async function generateSsoPortalLink(organization: string, config = getWorkosConfig()): Promise<string> {
  if (!config) throw new Error("WorkOS is not configured");
  const response = await fetch(`${config.apiBase}/portal/generate_link`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ organization, intent: "sso" }),
    signal: AbortSignal.timeout(12_000),
  });
  const json: any = await response.json().catch(() => null);
  if (!response.ok || typeof json?.link !== "string") throw new Error(json?.message || `WorkOS returned ${response.status}`);
  return json.link;
}

/**
 * Whether a WorkOS profile may sign in to a team: it must come from the
 * team's linked WorkOS organisation and, when the team has a verified
 * domain, use an address on it.
 */
export function profileMatchesTeam(profile: WorkosProfile, team: { workosOrganizationId: string | null; verifiedDomain: string | null }) {
  if (!team.workosOrganizationId || profile.organizationId !== team.workosOrganizationId) return false;
  if (!profile.email || !/^[^\s@]+@[^\s@]+$/.test(profile.email)) return false;
  if (team.verifiedDomain && profile.email.split("@")[1] !== team.verifiedDomain) return false;
  return true;
}

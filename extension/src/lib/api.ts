import superjson from "superjson";
import { siteUrl } from "./origin";

/**
 * A small client for the StudyScribe API, speaking the same wire format as the
 * web app: REST for the session (`/api/auth/me`) and uploads, tRPC over HTTP
 * at `/api/trpc` with the superjson transformer for everything else.
 *
 * Authentication is the site's own `studyscribe_session` cookie. The extension
 * holds host permission for the configured origin, so Chrome attaches that
 * cookie to these requests as it would to the site's own (SameSite=Lax
 * included); `credentials: "include"` is still required because the request
 * comes from the extension's origin. No token is stored by the extension.
 */

export type SessionUser = { id: number; email: string; name: string | null; role: string };

export type RecordingSummary = {
  id: number;
  title: string;
  status: "processing" | "completed" | "failed" | null;
  duration: number | null;
  createdAt: Date | string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get signedOut(): boolean {
    return this.status === 401 || this.code === "UNAUTHORIZED";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const NETWORK_ERROR = "StudyScribe could not be reached. Check your connection and the site address in Settings.";

export function encodeTrpcInput(input: unknown): string {
  return JSON.stringify(superjson.serialize(input));
}

/** Reads a tRPC response body: the result on success, an ApiError otherwise. */
export function decodeTrpcResponse<T>(status: number, body: unknown): T {
  const envelope = body as { result?: { data?: unknown }; error?: unknown } | null;
  if (envelope && envelope.result && "data" in envelope.result) {
    return superjson.deserialize(envelope.result.data as never) as T;
  }
  const rawError = envelope?.error as { json?: unknown } | undefined;
  const error = (rawError && typeof rawError === "object" && "json" in rawError ? rawError.json : rawError) as
    | { message?: string; data?: { code?: string; httpStatus?: number } }
    | undefined;
  const code = error?.data?.code;
  const httpStatus = error?.data?.httpStatus ?? status;
  if (code === "UNAUTHORIZED") throw new ApiError("Sign in to StudyScribe to continue.", 401, code);
  throw new ApiError(error?.message || `StudyScribe answered with an error (${status}).`, httpStatus, code);
}

export function createApi(origin: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetchImpl(siteUrl(origin, path), { credentials: "include", cache: "no-store", ...init });
    } catch {
      throw new ApiError(NETWORK_ERROR, 0);
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new ApiError(`StudyScribe answered with an unexpected response (${response.status}).`, response.status);
    }
  }

  async function query<T>(path: string, input?: unknown): Promise<T> {
    const search = input === undefined ? "" : `?input=${encodeURIComponent(encodeTrpcInput(input))}`;
    const response = await request(`/api/trpc/${path}${search}`);
    return decodeTrpcResponse<T>(response.status, await readJson(response));
  }

  async function mutation<T>(path: string, input: unknown): Promise<T> {
    const response = await request(`/api/trpc/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: encodeTrpcInput(input),
    });
    return decodeTrpcResponse<T>(response.status, await readJson(response));
  }

  return {
    origin,

    /** The signed-in person, or null when the site session is missing or expired. */
    async me(): Promise<SessionUser | null> {
      const response = await request("/api/auth/me");
      if (response.status === 401) return null;
      if (!response.ok) throw new ApiError(`StudyScribe answered with an error (${response.status}).`, response.status);
      return (await readJson(response)) as SessionUser;
    },

    async recentRecordings(limit = 5): Promise<RecordingSummary[]> {
      const rows = await query<RecordingSummary[]>("recordings.list");
      return [...rows]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
    },

    createFromUrl(input: { url: string; title?: string; language?: string }) {
      return mutation<{ id: number; title: string }>("recordings.createFromUrl", {
        url: input.url,
        audience: "student",
        ...(input.title ? { title: input.title } : {}),
        ...(input.language ? { language: input.language } : {}),
      });
    },

    createRecording(input: {
      title: string;
      duration: number;
      language?: string;
      audio: { audioUpload: { key: string; mimeType: string } } | { audioBase64: string };
    }) {
      return mutation<{ id: number; title: string }>("recordings.create", {
        title: input.title,
        audience: "student",
        duration: input.duration,
        ...(input.language ? { language: input.language } : {}),
        ...input.audio,
      });
    },

    /**
     * Asks for a presigned upload, as `client/src/lib/directAudioUpload.ts` does.
     * Null means the server has no Blob store (409) and the audio should be sent
     * inline instead.
     */
    async prepareUpload(input: { fileName: string; mimeType: string; size: number }) {
      const response = await request("/api/storage/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (response.status === 409) return null;
      const body = (await readJson(response)) as
        | { enabled: true; upload: { key: string; mimeType: string; uploadUrl: string; uploadContentType: string } }
        | { enabled: false }
        | { error?: string };
      if (response.status === 401) throw new ApiError("Sign in to StudyScribe to save this recording.", 401);
      if (!response.ok) throw new ApiError(("error" in body && body.error) || "Could not prepare the upload.", response.status);
      if (!("enabled" in body) || !body.enabled) return null;
      return body.upload;
    },
  };
}

export type StudyScribeApi = ReturnType<typeof createApi>;

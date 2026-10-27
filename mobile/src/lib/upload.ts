/**
 * Uploads a recording's audio (or a lecture video) the way the web does
 * (client/src/lib/directAudioUpload.ts): ask the server for a presigned
 * Vercel Blob upload, then send the bytes straight to storage.
 *
 *  - Up to 50MB: one PUT to the presigned URL (on a phone, as a native upload
 *    task that keeps going in the background on iOS).
 *  - Over 50MB: Blob's multipart protocol, authorised by
 *    /api/storage/upload-presigned (the same endpoint the web's
 *    `uploadPresigned` uses), sent as 8MB parts read from disk one at a time,
 *    so a 1GB video never sits in memory. Each part is retried on its own.
 *    The protocol mirrors @vercel/blob 2.8's client (API version 12); keep
 *    them in step when the server's @vercel/blob is upgraded.
 *  - When the server has no Blob storage (a local dev server), small files go
 *    inline as base64 through recordings.create, which is what the web does.
 *
 * Everything that touches the network or the file system is passed in, so
 * the chunking and retry logic is tested without either.
 */

export const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024;
export const PART_SIZE_BYTES = 8 * 1024 * 1024;
export const INLINE_MAX_BYTES = 15 * 1024 * 1024;
const BLOB_API_URL = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "12";
const PART_CONCURRENCY = 3;
const PART_ATTEMPTS = 4;

export type UploadSource = {
  name: string;
  mimeType: string;
  size: number;
  /** Reads `length` bytes starting at `offset`. */
  readChunk(offset: number, length: number): Promise<Uint8Array>;
  /** Whole file as base64, for the inline fallback. */
  readBase64(): Promise<string>;
};

export type UploadIo = {
  apiBase: string;
  token: string | null;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Sends the whole file in one PUT (native upload task on a phone). */
  putFile(url: string, headers: Record<string, string>, onProgress: (sent: number) => void): Promise<{ status: number; body: string }>;
  sleep?: (ms: number) => Promise<void>;
};

export type UploadedAudio =
  | { kind: "stored"; key: string; mimeType: string }
  | { kind: "inline"; base64: string; mimeType: string };

export class UploadError extends Error {}

export type PartPlan = { partNumber: number; start: number; length: number };

/** Splits a file into Blob multipart parts (1-based part numbers, last part shorter). */
export function planParts(size: number, partSize = PART_SIZE_BYTES): PartPlan[] {
  if (!Number.isFinite(size) || size <= 0) return [];
  const parts: PartPlan[] = [];
  for (let start = 0, partNumber = 1; start < size; start += partSize, partNumber++) {
    parts.push({ partNumber, start, length: Math.min(partSize, size - start) });
  }
  return parts;
}

/** The store id inside a Blob delegation token (`<base64url json>.<signature>`). */
export function storeIdFromDelegationToken(token: string): string {
  const dot = token.indexOf(".");
  if (dot < 0) throw new UploadError("The upload authorisation was malformed.");
  const segment = token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
  const json = JSON.parse(globalThis.atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, "=")));
  if (typeof json.storeId !== "string") throw new UploadError("The upload authorisation was malformed.");
  return json.storeId.startsWith("store_") ? json.storeId.slice("store_".length) : json.storeId;
}

type PresignedPayload = { params: Record<string, string>; delegationToken: string; signature: string };

export function presignedMpuUrl(pathname: string, payload: PresignedPayload) {
  const url = new URL(`${BLOB_API_URL}/mpu`);
  url.searchParams.set("pathname", pathname);
  for (const [key, value] of Object.entries(payload.params)) url.searchParams.set(key, value);
  url.searchParams.set("vercel-blob-delegation", payload.delegationToken);
  url.searchParams.set("vercel-blob-signature", payload.signature);
  return url.toString();
}

function authHeaders(io: UploadIo): Record<string, string> {
  return io.token ? { Authorization: `Bearer ${io.token}` } : {};
}

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : typeof body?.error?.message === "string" ? body.error.message : fallback;
}

export async function uploadAudio(source: UploadSource, io: UploadIo, onProgress: (fraction: number) => void = () => undefined): Promise<UploadedAudio> {
  const prepare = await io.fetch(`${io.apiBase}/api/storage/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(io) },
    body: JSON.stringify({ fileName: source.name, mimeType: source.mimeType, size: source.size }),
  });
  if (prepare.status === 409) {
    // No Blob storage on this server: the web falls back to an inline upload too.
    if (source.size > INLINE_MAX_BYTES) throw new UploadError("This server can only take recordings up to 15MB.");
    const base64 = await source.readBase64();
    onProgress(1);
    return { kind: "inline", base64, mimeType: source.mimeType };
  }
  if (!prepare.ok) throw new UploadError(await readError(prepare, "Could not prepare the upload."));
  const prepared = (await prepare.json()) as { enabled: boolean; upload?: { key: string; mimeType: string; uploadUrl: string; uploadContentType: string; provider?: "r2" | "blob" } };
  if (!prepared.enabled || !prepared.upload) throw new UploadError("Uploads are not available right now.");
  const { key, mimeType, uploadUrl, uploadContentType, provider } = prepared.upload;

  // R2 takes one signed PUT at any size; only Vercel Blob needs the multipart path.
  if (source.size <= MULTIPART_THRESHOLD_BYTES || provider === "r2") {
    const result = await io.putFile(uploadUrl, { "Content-Type": uploadContentType }, (sent) => onProgress(Math.min(1, sent / source.size)));
    if (result.status < 200 || result.status >= 300) {
      throw new UploadError(`The upload could not be completed (${result.status}${result.body ? `: ${result.body.slice(0, 200)}` : ""}).`);
    }
    onProgress(1);
    return { kind: "stored", key, mimeType };
  }

  await multipartUpload(key, uploadContentType, source, io, onProgress);
  return { kind: "stored", key, mimeType };
}

export async function multipartUpload(pathname: string, contentType: string, source: UploadSource, io: UploadIo, onProgress: (fraction: number) => void) {
  const sleep = io.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const authorise = await io.fetch(`${io.apiBase}/api/storage/upload-presigned`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(io) },
    body: JSON.stringify({
      type: "blob.generate-presigned-url",
      payload: { pathname, clientPayload: JSON.stringify({ size: source.size }), multipart: true },
    }),
  });
  if (!authorise.ok) throw new UploadError(await readError(authorise, "Could not authorise the upload."));
  const { presignedUrlPayload } = (await authorise.json()) as { presignedUrlPayload?: PresignedPayload };
  if (!presignedUrlPayload) throw new UploadError("Could not authorise the upload.");

  const url = presignedMpuUrl(pathname, presignedUrlPayload);
  const storeId = storeIdFromDelegationToken(presignedUrlPayload.delegationToken);
  const requestId = `${storeId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const baseHeaders = (attempt: number): Record<string, string> => ({
    "x-api-version": BLOB_API_VERSION,
    "x-api-blob-request-id": requestId,
    "x-api-blob-request-attempt": String(attempt),
    "x-vercel-blob-store-id": storeId,
    "x-vercel-blob-access": "private",
    "x-content-type": contentType,
  });

  async function call<T>(label: string, init: (attempt: number) => RequestInit): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < PART_ATTEMPTS; attempt++) {
      try {
        const response = await io.fetch(url, init(attempt));
        if (response.ok) return (await response.json()) as T;
        // 4xx other than rate limiting will not get better by retrying.
        if (response.status < 500 && response.status !== 429) throw new UploadError(await readError(response, `${label} failed (${response.status}).`));
        lastError = new UploadError(`${label} failed (${response.status}).`);
      } catch (error) {
        if (error instanceof UploadError && !/failed \((5\d\d|429)\)/.test(error.message)) throw error;
        lastError = error;
      }
      await sleep(500 * 2 ** attempt);
    }
    throw lastError instanceof Error ? lastError : new UploadError(`${label} failed.`);
  }

  const created = await call<{ key: string; uploadId: string }>("Starting the upload", (attempt) => ({
    method: "POST",
    headers: { ...baseHeaders(attempt), "x-mpu-action": "create" },
  }));

  const plan = planParts(source.size);
  const done: { etag: string; partNumber: number }[] = [];
  let sent = 0;
  let next = 0;

  async function worker() {
    while (next < plan.length) {
      const part = plan[next++];
      // Read just before sending, so at most PART_CONCURRENCY parts are in memory.
      const bytes = await source.readChunk(part.start, part.length);
      const result = await call<{ etag: string }>(`Part ${part.partNumber}`, (attempt) => ({
        method: "POST",
        headers: {
          ...baseHeaders(attempt),
          "x-mpu-action": "upload",
          "x-mpu-key": encodeURIComponent(created.key),
          "x-mpu-upload-id": created.uploadId,
          "x-mpu-part-number": String(part.partNumber),
        },
        body: bytes as unknown as BodyInit,
      }));
      done.push({ etag: result.etag, partNumber: part.partNumber });
      sent += part.length;
      onProgress(Math.min(0.99, sent / source.size));
    }
  }

  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, plan.length) }, worker));
  done.sort((a, b) => a.partNumber - b.partNumber);

  await call("Finishing the upload", (attempt) => ({
    method: "POST",
    headers: {
      ...baseHeaders(attempt),
      "content-type": "application/json",
      "x-mpu-action": "complete",
      "x-mpu-upload-id": created.uploadId,
      "x-mpu-key": encodeURIComponent(created.key),
    },
    body: JSON.stringify(done),
  }));
  onProgress(1);
}

/** Content type for a picked file, from its declared type or its extension (pickers often report a generic type for .mov). */
const EXTENSION_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  aac: "audio/aac",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  caf: "audio/x-caf",
  "3gp": "video/3gpp",
  mkv: "video/x-matroska",
  aiff: "audio/aiff",
  wma: "audio/x-ms-wma",
};

export function contentTypeFor(name: string, declared?: string | null) {
  const type = declared?.split(";")[0].trim().toLowerCase();
  if (type && type !== "application/octet-stream" && type !== "binary/octet-stream") return type;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "application/octet-stream";
}

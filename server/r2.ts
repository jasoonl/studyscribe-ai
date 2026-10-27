/**
 * Cloudflare R2 (S3-compatible) storage client with no SDK: AWS Signature V4
 * query-string signing (presigned URLs) built on node:crypto, plus the few
 * object operations the app needs (HEAD, DELETE, PUT of a buffer, a streamed
 * PUT that switches to multipart for large bodies, and a bucket check).
 *
 * R2 has no egress fees and a free tier of 10 GB, which is why it can replace
 * Vercel Blob. Every server-side request is a presigned URL fetched without
 * extra headers (apart from Content-Type on writes, which is signed), so there
 * is one signing path to get right. Nothing here puts a key, a secret or a
 * signed URL into an error message: signed URLs carry the access key id.
 */
import { createHash, createHmac } from "node:crypto";

const R2_REGION = "auto";
const S3_SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

/** Largest expiry S3 accepts (7 days). */
export const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;
/** Multipart parts must be at least 5 MiB (except the last); 8 MiB keeps memory modest. */
export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Optional override of `https://<account>.r2.cloudflarestorage.com` (tests, mock server). */
  endpoint?: string;
};

export function getR2Config(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = env.R2_ENDPOINT?.trim();
  return { accountId, accessKeyId, secretAccessKey, bucket, ...(endpoint ? { endpoint } : {}) };
}

export function isR2StorageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getR2Config(env) !== null;
}

// ---- SigV4 -------------------------------------------------------------------------------

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value, "utf8").digest();

/** RFC 3986 encoding as SigV4 requires (everything except A-Z a-z 0-9 - _ . ~). */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  const bytes = Buffer.from(value, "utf8");
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(char) || (char === "/" && !encodeSlash)) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), "aws4_request");
}

export type PresignInput = {
  method: string;
  /** Host header value, including a non-default port. */
  host: string;
  /** Request path, not yet encoded (`/bucket/some key.bin`); each segment is encoded here. */
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  service?: string;
  now?: Date;
  expiresInSeconds: number;
  /** Extra query parameters that are part of the request (`uploads`, `partNumber`, ...). */
  query?: Record<string, string>;
  /** Headers besides `host` that the request must send exactly as given (lowercase names). */
  signedHeaders?: Record<string, string>;
  protocol?: "https" | "http";
};

/** Builds a SigV4 query-string presigned URL (UNSIGNED-PAYLOAD). */
export function presign(input: PresignInput): string {
  const region = input.region ?? R2_REGION;
  const service = input.service ?? S3_SERVICE;
  const now = input.now ?? new Date();
  const stamp = amzDate(now);
  const dateStamp = stamp.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  if (!Number.isInteger(input.expiresInSeconds) || input.expiresInSeconds < 1 || input.expiresInSeconds > MAX_PRESIGN_SECONDS) {
    throw new Error("Presigned URL expiry must be between 1 second and 7 days");
  }

  const headers: Record<string, string> = { host: input.host };
  for (const [name, value] of Object.entries(input.signedHeaders ?? {})) headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  const headerNames = Object.keys(headers).sort();

  const query: Record<string, string> = {
    ...(input.query ?? {}),
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": headerNames.join(";"),
  };
  const canonicalQuery = Object.keys(query)
    .map((name) => [uriEncode(name), uriEncode(query[name])] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const canonicalPath = input.path.split("/").map((segment) => uriEncode(segment)).join("/");
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath,
    canonicalQuery,
    headerNames.map((name) => `${name}:${headers[name]}\n`).join(""),
    headerNames.join(";"),
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(input.secretAccessKey, dateStamp, region, service)).update(stringToSign, "utf8").digest("hex");
  return `${input.protocol ?? "https"}://${input.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ---- R2 operations -----------------------------------------------------------------------

function target(config: R2Config) {
  const base = new URL(config.endpoint || `https://${config.accountId}.r2.cloudflarestorage.com`);
  return { host: base.host, protocol: (base.protocol === "http:" ? "http" : "https") as "http" | "https", prefix: base.pathname.replace(/\/+$/, "") };
}

function objectPath(config: R2Config, key: string) {
  return `${target(config).prefix}/${config.bucket}/${key.replace(/^\/+/, "")}`;
}

function presignObject(
  config: R2Config,
  method: string,
  key: string | null,
  options: { expiresInSeconds: number; contentType?: string; contentLength?: number; query?: Record<string, string>; now?: Date },
): string {
  const { host, protocol, prefix } = target(config);
  const signedHeaders: Record<string, string> = {};
  if (options.contentType) signedHeaders["content-type"] = options.contentType;
  if (options.contentLength !== undefined) signedHeaders["content-length"] = String(options.contentLength);
  return presign({
    method,
    host,
    protocol,
    path: key === null ? `${prefix}/${config.bucket}` : objectPath(config, key),
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresInSeconds: options.expiresInSeconds,
    query: options.query,
    signedHeaders,
    now: options.now,
  });
}

/**
 * URL a browser (or phone, or extension) PUTs the file to. Content-Type and
 * Content-Length are signed, so the upload must be exactly this type and size;
 * both are sent automatically by browsers for a Blob body.
 */
export function presignPut(config: R2Config, key: string, options: { contentType: string; contentLength: number; expiresInSeconds?: number; now?: Date }): string {
  if (!Number.isFinite(options.contentLength) || options.contentLength <= 0) throw new Error("A positive content length is required");
  return presignObject(config, "PUT", key, { ...options, expiresInSeconds: options.expiresInSeconds ?? 600 });
}

export function presignGet(config: R2Config, key: string, options: { expiresInSeconds?: number; now?: Date } = {}): string {
  return presignObject(config, "GET", key, { ...options, expiresInSeconds: options.expiresInSeconds ?? 600 });
}

export class R2Error extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "R2Error";
  }
}

type Fetcher = typeof fetch;

async function send(fetcher: Fetcher, url: string, init: RequestInit & { duplex?: "half" }, what: string, timeoutMs = 30_000): Promise<Response> {
  try {
    return await fetcher(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    // Never include the URL (it carries the access key id) or the underlying message.
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new R2Error(timedOut ? `${what} timed out` : `${what} could not reach storage`);
  }
}

function failure(what: string, response: Response): R2Error {
  return new R2Error(`${what} failed (storage returned ${response.status})`, response.status);
}

/** Object size and content type, or null when the object does not exist. */
export async function r2Head(config: R2Config, key: string, fetcher: Fetcher = fetch): Promise<{ size: number; contentType: string } | null> {
  const response = await send(fetcher, presignObject(config, "HEAD", key, { expiresInSeconds: 60 }), { method: "HEAD" }, "Checking the stored file");
  if (response.status === 404) return null;
  if (!response.ok) throw failure("Checking the stored file", response);
  return { size: Number(response.headers.get("content-length") ?? 0), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}

/** Deletes an object. A missing object is fine (S3 answers 204 for those too). */
export async function r2Delete(config: R2Config, key: string, fetcher: Fetcher = fetch): Promise<void> {
  const response = await send(fetcher, presignObject(config, "DELETE", key, { expiresInSeconds: 60 }), { method: "DELETE" }, "Deleting the stored file");
  if (!response.ok && response.status !== 404) throw failure("Deleting the stored file", response);
}

export const HEALTHCHECK_KEY = ".healthcheck";

/**
 * Reachability and credentials check for System health: a signed HEAD on a fixed key that does not exist.
 * 404 (or 200) means the bucket answered and the key is authorized; 403 means the key was refused. (HEAD on the
 * bucket itself needs list-type permission that an object-scoped token may lack, so it is not used.)
 */
export async function r2CheckBucket(config: R2Config, fetcher: Fetcher = fetch, timeoutMs = 5_000): Promise<{ ok: boolean; status: number | null }> {
  try {
    const response = await fetcher(presignObject(config, "HEAD", HEALTHCHECK_KEY, { expiresInSeconds: 60 }), { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    return { ok: response.ok || response.status === 404, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

export async function r2PutBuffer(config: R2Config, key: string, data: Uint8Array, contentType: string, fetcher: Fetcher = fetch): Promise<void> {
  const body = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const url = presignObject(config, "PUT", key, { expiresInSeconds: 600, contentType, contentLength: body.byteLength });
  const response = await send(fetcher, url, { method: "PUT", headers: { "Content-Type": contentType }, body: body as unknown as BodyInit }, "Uploading the file", 60_000);
  if (!response.ok) throw failure("Uploading the file", response);
}

async function readPart(reader: ReadableStreamDefaultReader<Uint8Array>, carry: Buffer[], carried: { bytes: number }, size: number): Promise<{ part: Buffer; done: boolean }> {
  let done = false;
  while (carried.bytes < size) {
    const next = await reader.read();
    if (next.done) {
      done = true;
      break;
    }
    carry.push(Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength));
    carried.bytes += next.value.byteLength;
  }
  const all = Buffer.concat(carry);
  carry.length = 0;
  const part = all.subarray(0, size);
  const rest = all.subarray(size);
  carry.push(rest);
  carried.bytes = rest.byteLength;
  return { part, done: done && rest.byteLength === 0 };
}

/**
 * Stores a body of unknown length (a link import). Bodies under one part are a
 * single PUT; larger ones use S3 multipart in 8 MiB parts, so memory stays
 * bounded. A failed multipart upload is aborted so no parts are left billed.
 */
export async function r2PutStream(config: R2Config, key: string, body: ReadableStream<Uint8Array>, contentType: string, fetcher: Fetcher = fetch): Promise<{ bytes: number }> {
  const reader = body.getReader();
  const carry: Buffer[] = [];
  const carried = { bytes: 0 };
  const first = await readPart(reader, carry, carried, MULTIPART_PART_BYTES);
  if (first.done) {
    if (first.part.byteLength === 0) throw new R2Error("The file was empty");
    await r2PutBuffer(config, key, first.part, contentType, fetcher);
    return { bytes: first.part.byteLength };
  }

  const createUrl = presignObject(config, "POST", key, { expiresInSeconds: 600, contentType, query: { uploads: "" } });
  const created = await send(fetcher, createUrl, { method: "POST", headers: { "Content-Type": contentType } }, "Starting the upload");
  if (!created.ok) throw failure("Starting the upload", created);
  const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(await created.text())?.[1];
  if (!uploadId) throw new R2Error("Starting the upload failed (storage gave no upload id)");

  const etags: Array<{ partNumber: number; etag: string }> = [];
  let total = 0;
  try {
    let current = first;
    for (let partNumber = 1; ; partNumber += 1) {
      const url = presignObject(config, "PUT", key, { expiresInSeconds: 3600, query: { partNumber: String(partNumber), uploadId } });
      const response = await send(fetcher, url, { method: "PUT", body: current.part as unknown as BodyInit }, "Uploading a part of the file", 120_000);
      if (!response.ok) throw failure("Uploading a part of the file", response);
      const etag = response.headers.get("etag");
      if (!etag) throw new R2Error("Uploading a part of the file failed (storage gave no part id)");
      etags.push({ partNumber, etag });
      total += current.part.byteLength;
      if (current.done) break;
      current = await readPart(reader, carry, carried, MULTIPART_PART_BYTES);
      if (current.part.byteLength === 0) break;
    }
    const xml = `<CompleteMultipartUpload>${etags.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
    const completeUrl = presignObject(config, "POST", key, { expiresInSeconds: 600, query: { uploadId } });
    const completed = await send(fetcher, completeUrl, { method: "POST", headers: { "Content-Type": "application/xml" }, body: xml }, "Finishing the upload");
    // S3 can answer 200 with an <Error> body.
    const text = await completed.text();
    if (!completed.ok || /<Error>/.test(text)) throw new R2Error(`Finishing the upload failed (storage returned ${completed.status})`, completed.status);
    return { bytes: total };
  } catch (error) {
    const abortUrl = presignObject(config, "DELETE", key, { expiresInSeconds: 60, query: { uploadId } });
    await fetcher(abortUrl, { method: "DELETE", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    throw error;
  }
}

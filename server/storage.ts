import { BlobNotFoundError, del, head, issueSignedToken, list, presignUrl, put } from "@vercel/blob";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@shared/const";
import { ENV } from "./_core/env";

const MAX_AUDIO_SIZE_BYTES = MAX_UPLOAD_BYTES;
const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a",
  // Formats that only arrive through link imports. The transcription provider
  // decodes them itself; browsers may not be able to play some back.
  "audio/flac", "audio/aac", "audio/aiff", "audio/x-ms-wma",
  "video/x-matroska", "video/x-msvideo", "video/mpeg", "video/3gpp", "video/x-ms-wmv",
]);

/**
 * Browsers report MediaRecorder.mimeType with codec parameters attached
 * (e.g. `audio/webm;codecs=opus`), which never matches AUDIO_MIME_TYPES
 * exactly. Strip parameters before validating or allow-listing the type.
 *
 * Some browsers also report an audio-only recording's container under a
 * `video/*` label (e.g. `video/webm` with no video track at all) — a known
 * MediaRecorder quirk, not an actual video upload. Vercel Blob's storage
 * enforces its own content-type policy independent of what we allow-list
 * and rejects `video/*` outright with 403 "contentType ... is not
 * allowed", so relabel to the audio equivalent before it ever reaches Blob.
 * Every upload through this path is audio-only by construction (recording
 * or an audio file picker).
 */
export function normalizeAudioMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base === "video/webm") return "audio/webm";
  // MP4, QuickTime and M4V all carry their audio in an MP4-family container,
  // so they store and play back as audio/mp4. Imported video links land here
  // too — the transcription provider extracts the audio track itself.
  if (base === "video/mp4" || base === "video/quicktime" || base === "video/x-m4v") return "audio/mp4";
  // Ogg video (.ogv) and Opus-in-Ogg (.opus) are Ogg containers.
  if (base === "video/ogg" || base === "audio/opus") return "audio/ogg";
  if (base === "audio/x-flac") return "audio/flac";
  if (base === "audio/x-aiff") return "audio/aiff";
  return base;
}

export function isVercelBlobStorageConfigured() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
    (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
}

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error("Storage config missing: set a Vercel Blob connection or BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY");
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

function publicStorageProxyUrl(key: string) {
  return `/api/storage?key=${encodeURIComponent(key)}`;
}

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  webm: "audio/webm",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  flac: "audio/flac",
  aac: "audio/aac",
  aiff: "audio/aiff",
  wma: "audio/x-ms-wma",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mpeg: "video/mpeg",
  "3gp": "video/3gpp",
  wmv: "video/x-ms-wmv",
};

/**
 * Short labels embedded in the storage key (see createDirectAudioUpload)
 * so playback can recover the real audio type without the key itself
 * ending in a `.webm`/`.mp4` extension — those are the exact extensions
 * that made Vercel Blob's presigned PUT reject the upload as "video/webm
 * is not allowed" even after every other content-type declaration (the
 * PUT header, the signed token's allowedContentTypes) was changed to a
 * generic type. Vercel Blob infers/validates a presigned upload's content
 * type from the pathname extension independent of those declarations, and
 * .webm/.mp4 are canonically registered as video/* in the standard MIME
 * database — so any key ending in one, even for audio-only content, was
 * doomed regardless of what we told Blob to expect. Keeping the key
 * extension a neutral `.bin` avoids that inference entirely.
 */
const AUDIO_TYPE_LABELS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "audio/aiff": "aiff",
  "audio/x-ms-wma": "wma",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
  "video/mpeg": "mpeg",
  "video/3gpp": "3gp",
  "video/x-ms-wmv": "wmv",
};

/**
 * Since uploads are stored with a generic Content-Type and a neutral `.bin`
 * key extension, playback must derive the real Content-Type itself rather
 * than trusting Blob's stored metadata or the pathname. Keys created by
 * createDirectAudioUpload embed the real type as a `-<label>.bin` suffix;
 * older keys (from the base64 fallback path) still end in a real
 * extension, so fall back to that lookup for those.
 */
export function contentTypeFromStorageKey(key: string): string {
  const base = key.split("/").pop() ?? "";
  const labelMatch = base.match(/-([a-z0-9]+)\.bin$/i);
  if (labelMatch) {
    const label = EXTENSION_CONTENT_TYPES[labelMatch[1].toLowerCase()];
    if (label) return label;
  }
  const extension = base.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_CONTENT_TYPES[extension] || "application/octet-stream";
}

/**
 * Declared on both the signed token and the PUT header for every direct
 * upload (see the AUDIO_TYPE_LABELS comment above for why the key's own
 * extension is neutral too — belt and braces against Blob's content-type
 * handling). The real, validated audio MIME type is still returned
 * separately (as `mimeType`) for the caller to use.
 */
const BLOB_UPLOAD_CONTENT_TYPE = "application/octet-stream";

export async function createDirectAudioUpload(input: {
  userId: number;
  fileName: string;
  mimeType: string;
  size: number;
}): Promise<{ key: string; mimeType: string; uploadUrl: string; uploadContentType: string } | null> {
  if (!isVercelBlobStorageConfigured()) return null;
  const mimeType = normalizeAudioMimeType(input.mimeType);
  if (!AUDIO_MIME_TYPES.has(mimeType)) throw new Error(`Unsupported audio format: ${input.mimeType}`);
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_AUDIO_SIZE_BYTES) {
    throw new Error(`Audio file must be between 1 byte and ${MAX_UPLOAD_LABEL}`);
  }

  const label = AUDIO_TYPE_LABELS[mimeType] || "audio";
  const key = `${input.userId}/recordings/${crypto.randomUUID()}-${label}.bin`;
  const validUntil = Date.now() + 10 * 60 * 1_000;
  const signedToken = await issueSignedToken({
    pathname: key,
    operations: ["put"],
    allowedContentTypes: [BLOB_UPLOAD_CONTENT_TYPE],
    maximumSizeInBytes: MAX_AUDIO_SIZE_BYTES,
    validUntil,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "put",
    pathname: key,
    access: "private",
    allowedContentTypes: [BLOB_UPLOAD_CONTENT_TYPE],
    maximumSizeInBytes: MAX_AUDIO_SIZE_BYTES,
    allowOverwrite: false,
    addRandomSuffix: false,
    validUntil,
  });

  return { key, mimeType, uploadUrl: presignedUrl, uploadContentType: BLOB_UPLOAD_CONTENT_TYPE };
}

/**
 * Server-side counterpart to createDirectAudioUpload, for audio this server
 * fetched itself (link imports) rather than received from the browser. Uses
 * the same neutral-extension key convention so playback recovers the real
 * content type the same way.
 */
export async function putAudioStream(input: {
  userId: number;
  mimeType: string;
  body: ReadableStream<Uint8Array>;
}): Promise<{ key: string; mimeType: string; url: string }> {
  if (!isVercelBlobStorageConfigured()) throw new Error("Storage is not configured");

  const mimeType = normalizeAudioMimeType(input.mimeType);
  if (!AUDIO_MIME_TYPES.has(mimeType)) throw new Error(`Unsupported audio format: ${input.mimeType}`);

  const label = AUDIO_TYPE_LABELS[mimeType] || "audio";
  const key = `${input.userId}/recordings/${crypto.randomUUID()}-${label}.bin`;
  const result = await put(key, input.body, {
    access: "private",
    addRandomSuffix: false,
    contentType: BLOB_UPLOAD_CONTENT_TYPE,
    multipart: true,
  });

  return { key: result.pathname, mimeType, url: publicStorageProxyUrl(result.pathname) };
}

/**
 * Total bytes held in the Blob store. Blob storage is the binding capacity
 * limit (Hobby includes 1GB; a store over its limit is suspended and every
 * upload fails), and nothing surfaced it, so it was found only by hitting it.
 * The limit itself isn't readable from the API, so it comes from config.
 */
export async function getBlobUsage(): Promise<{
  configured: boolean;
  totalBytes: number;
  objectCount: number;
  limitBytes: number;
}> {
  const limitBytes = Number(process.env.BLOB_STORAGE_LIMIT_BYTES) || 1024 * 1024 * 1024;
  if (!isVercelBlobStorageConfigured()) return { configured: false, totalBytes: 0, objectCount: 0, limitBytes };

  let totalBytes = 0;
  let objectCount = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ limit: 1000, cursor });
    for (const blob of page.blobs) {
      totalBytes += blob.size;
      objectCount += 1;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return { configured: true, totalBytes, objectCount, limitBytes };
}

/**
 * Removes stored audio. "Delete forever" used to drop only the database row,
 * so the file kept counting against the storage limit with nothing left that
 * pointed at it. A missing object is fine (already gone); any other failure is
 * reported to the caller rather than swallowed.
 */
export async function deleteStoredAudio(keys: string[]): Promise<void> {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (unique.length === 0 || !isVercelBlobStorageConfigured()) return;
  for (let i = 0; i < unique.length; i += 100) {
    try {
      await del(unique.slice(i, i + 100));
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) throw error;
    }
  }
}

/**
 * The browser uploads straight to Blob, so a PUT that returns OK is the only
 * signal the client has that the audio actually landed. Nothing downstream
 * checked that, which meant a failed or empty upload produced a recording row
 * that looked fine, played silence, and failed transcription with no
 * explanation. Confirm the object really exists and has bytes before we
 * commit a recording to it.
 */
export async function verifyUploadedAudio(key: string): Promise<{ size: number; contentType: string }> {
  if (!isVercelBlobStorageConfigured()) throw new Error("Storage is not configured");

  let metadata;
  try {
    metadata = await head(key);
  } catch (error) {
    throw new Error(
      `The uploaded audio could not be found in storage (${error instanceof Error ? error.message : "unknown error"}). Please try recording or uploading again.`,
    );
  }

  if (!metadata || metadata.size <= 0) {
    throw new Error("The uploaded audio file is empty. Please try recording or uploading again.");
  }

  return { size: metadata.size, contentType: metadata.contentType };
}

/**
 * The transcription provider fetches the audio itself from a signed URL, so a
 * URL it cannot read shows up only as an opaque provider-side failure much
 * later. Reading the first byte ourselves first turns that into a precise,
 * immediate error naming the actual status the provider would have hit.
 */
export async function assertSignedAudioUrlIsFetchable(signedUrl: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(signedUrl, { headers: { Range: "bytes=0-0" } });
  } catch (error) {
    throw new Error(
      `The audio could not be retrieved for transcription: ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  if (!response.ok && response.status !== 206) {
    throw new Error(
      `The audio could not be retrieved for transcription (storage returned ${response.status}). The recording may be missing from storage.`,
    );
  }

  await response.body?.cancel().catch(() => undefined);
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  if (isVercelBlobStorageConfigured()) {
    const key = normalizeKey(relKey);
    const blobData = typeof data === "string" || !Buffer.isBuffer(data) ? Buffer.from(data) : data;
    const result = await put(key, blobData, {
      access: "private",
      addRandomSuffix: true,
      contentType,
    });
    return { key: result.pathname, url: publicStorageProxyUrl(result.pathname) };
  }

  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, { headers: { Authorization: `Bearer ${forgeKey}` } });
  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url) throw new Error("Forge returned empty presign URL");
  const body = typeof data === "string" ? Buffer.from(data) : data;
  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: body as any,
  });
  if (!uploadResp.ok) throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  if (isVercelBlobStorageConfigured()) return { key, url: publicStorageProxyUrl(key) };
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  if (isVercelBlobStorageConfigured()) {
    const key = normalizeKey(relKey);
    const validUntil = Date.now() + 10 * 60 * 1_000;
    const signedToken = await issueSignedToken({ pathname: key, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(signedToken, {
      operation: "get",
      pathname: key,
      access: "private",
      validUntil,
    });
    return presignedUrl;
  }

  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeKey(relKey);
  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);
  const resp = await fetch(getUrl, { headers: { Authorization: `Bearer ${forgeKey}` } });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }
  const { url } = (await resp.json()) as { url: string };
  return url;
}

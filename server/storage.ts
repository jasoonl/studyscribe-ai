import { issueSignedToken, presignUrl, put } from "@vercel/blob";
import { ENV } from "./_core/env";

const MAX_AUDIO_SIZE_BYTES = 16 * 1024 * 1024;
const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "video/mp4", "video/webm",
]);

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

function safeFileName(fileName: string) {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return cleaned.slice(-100) || "recording.webm";
}

export async function createDirectAudioUpload(input: {
  userId: number;
  fileName: string;
  mimeType: string;
  size: number;
}): Promise<{ key: string; mimeType: string; uploadUrl: string } | null> {
  if (!isVercelBlobStorageConfigured()) return null;
  if (!AUDIO_MIME_TYPES.has(input.mimeType)) throw new Error("Unsupported audio format");
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_AUDIO_SIZE_BYTES) {
    throw new Error("Audio file must be between 1 byte and 16MB");
  }

  const key = `${input.userId}/recordings/${crypto.randomUUID()}-${safeFileName(input.fileName)}`;
  const validUntil = Date.now() + 10 * 60 * 1_000;
  const signedToken = await issueSignedToken({
    pathname: key,
    operations: ["put"],
    allowedContentTypes: [input.mimeType],
    maximumSizeInBytes: MAX_AUDIO_SIZE_BYTES,
    validUntil,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "put",
    pathname: key,
    access: "private",
    allowedContentTypes: [input.mimeType],
    maximumSizeInBytes: MAX_AUDIO_SIZE_BYTES,
    allowOverwrite: false,
    addRandomSuffix: false,
    validUntil,
  });

  return { key, mimeType: input.mimeType, uploadUrl: presignedUrl };
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

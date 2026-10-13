import type { StudyScribeApi } from "./api";
import { isSameOrigin, siteUrl } from "./origin";

/**
 * Upload helpers for a finished tab recording. The flow is the web app's
 * (`client/src/lib/directAudioUpload.ts`): ask `/api/storage/upload-url` for a
 * presigned Blob URL and PUT the file there, or send it in parts through the
 * Blob SDK's multipart uploader above 50MB (one PUT of several hundred MB
 * fails), or, when the server has no Blob store, send it inline as base64.
 */

export const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024;
/** `recordings.create` takes base64 in a JSON body capped at 50MB by the server, and base64 adds a third. */
export const INLINE_LIMIT_BYTES = 36 * 1024 * 1024;
export const MAX_RECORDING_BYTES = 1024 * 1024 * 1024;

export type UploadPlan = "single" | "multipart";

export function planUpload(size: number): UploadPlan {
  if (!Number.isFinite(size) || size <= 0) throw new Error("The recording is empty.");
  if (size > MAX_RECORDING_BYTES) throw new Error("The recording is larger than 1GB and cannot be uploaded.");
  return size > MULTIPART_THRESHOLD_BYTES ? "multipart" : "single";
}

/** The container MediaRecorder produced, without codec parameters, and the server's name for it. */
export function recordingMimeType(recorderMimeType: string): "audio/webm" | "audio/mp4" | "audio/ogg" {
  const base = recorderMimeType.split(";")[0].trim().toLowerCase();
  if (base.endsWith("/mp4")) return "audio/mp4";
  if (base.endsWith("/ogg")) return "audio/ogg";
  return "audio/webm";
}

export function recordingFileName(mimeType: string, now = new Date()): string {
  const extension = mimeType === "audio/mp4" ? "mp4" : mimeType === "audio/ogg" ? "ogg" : "webm";
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  return `tab-recording-${stamp}.${extension}`;
}

/** Joins MediaRecorder's timesliced chunks into one file, skipping empty slices. */
export function assembleRecording(chunks: Blob[], mimeType: string): Blob {
  const parts = chunks.filter(chunk => chunk.size > 0);
  if (parts.length === 0) throw new Error("No audio was captured. Check that the tab was playing sound.");
  return new Blob(parts, { type: mimeType });
}

/**
 * Splits upload progress into the overall bar: preparing takes the first
 * tenth, sending the file runs to 90%, creating the recording finishes it.
 */
export function overallProgress(stage: "prepare" | "send" | "create", fraction = 0): number {
  const f = Math.min(1, Math.max(0, fraction));
  if (stage === "prepare") return Math.round(5 + 5 * f);
  if (stage === "send") return Math.round(10 + 80 * f);
  return Math.round(90 + 10 * f);
}

/**
 * The Blob SDK's uploader calls `fetch` without credentials, which from the
 * extension's origin would drop the session cookie on its token request. This
 * wraps fetch so requests to the StudyScribe origin, and only those, carry it.
 */
export function withSiteCredentials(origin: string, baseFetch: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (isSameOrigin(url, origin)) return baseFetch(input, { ...init, credentials: "include" });
    return baseFetch(input, init);
  }) as typeof fetch;
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return `data:${blob.type || "audio/webm"};base64,${btoa(binary)}`;
}

export type MultipartUploader = (input: {
  key: string;
  body: Blob;
  contentType: string;
  handleUploadUrl: string;
  size: number;
  onProgress: (fraction: number) => void;
}) => Promise<void>;

export type UploadDeps = {
  api: StudyScribeApi;
  put: (url: string, init: RequestInit) => Promise<Response>;
  multipart: MultipartUploader;
};

export type UploadedAudio = { audioUpload: { key: string; mimeType: string } } | { audioBase64: string };

/** Sends the recording to storage and returns what `recordings.create` needs to find it. */
export async function uploadRecordingAudio(
  blob: Blob,
  fileName: string,
  deps: UploadDeps,
  onProgress: (percent: number) => void,
): Promise<UploadedAudio> {
  const plan = planUpload(blob.size);
  onProgress(overallProgress("prepare"));
  const prepared = await deps.api.prepareUpload({ fileName, mimeType: blob.type, size: blob.size });
  onProgress(overallProgress("prepare", 1));

  if (!prepared) {
    if (blob.size > INLINE_LIMIT_BYTES) {
      throw new Error("This server can only take recordings up to 36MB. Ask the site owner to set up file storage.");
    }
    const audioBase64 = await blobToDataUrl(blob);
    onProgress(overallProgress("send", 1));
    return { audioBase64 };
  }

  // The generic content type the server assigned, on the body as well as the header (see directAudioUpload.ts).
  const body = new Blob([blob], { type: prepared.uploadContentType });
  if (plan === "multipart") {
    await deps.multipart({
      key: prepared.key,
      body,
      contentType: prepared.uploadContentType,
      handleUploadUrl: siteUrl(deps.api.origin, "/api/storage/upload-presigned"),
      size: blob.size,
      onProgress: fraction => onProgress(overallProgress("send", fraction)),
    });
  } else {
    const response = await deps.put(prepared.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": prepared.uploadContentType },
      body,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`The audio upload could not be completed (${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}).`);
    }
  }
  onProgress(overallProgress("send", 1));
  return { audioUpload: { key: prepared.key, mimeType: prepared.mimeType } };
}

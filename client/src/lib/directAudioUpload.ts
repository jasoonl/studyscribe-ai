export type PreparedAudioUpload = {
  key: string;
  mimeType: string;
  uploadUrl: string;
  uploadContentType: string;
};

type UploadPreparationResponse =
  | { enabled: true; upload: PreparedAudioUpload }
  | { enabled: false };

/**
 * Uses a Vercel-issued, short-lived PUT URL when the external deployment has
 * Blob configured. A null result deliberately preserves the Manus storage
 * fallback during the staged migration.
 */
export async function uploadAudioDirectly(
  file: Blob,
  fileName: string,
  onProgress?: (progress: number) => void,
): Promise<{ key: string; mimeType: string } | null> {
  const mimeType = file.type || "audio/webm";
  const preparationResponse = await fetch("/api/storage/upload-url", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, mimeType, size: file.size }),
  });

  if (preparationResponse.status === 409) return null;
  if (!preparationResponse.ok) {
    const body = await preparationResponse.json().catch(() => null);
    throw new Error(body?.error || "Could not prepare a secure audio upload");
  }

  const prepared = (await preparationResponse.json()) as UploadPreparationResponse;
  if (!prepared.enabled) return null;

  onProgress?.(25);
  // Upload with the server-assigned generic content type, not the audio
  // MIME type — Vercel Blob's storage has rejected specific audio/video
  // content types outright (403) even when explicitly allow-listed. Also
  // re-wrap in a Blob whose own `.type` matches that header exactly, since
  // `file.type` may still be the browser's raw, unnormalized value (e.g.
  // "video/webm" for an audio-only MediaRecorder quirk) and some layers
  // derive the upload's actual content type from the body's own Blob
  // metadata rather than (or in addition to) the explicit header.
  const uploadBody = new Blob([file], { type: prepared.upload.uploadContentType });
  const uploadResponse = await fetch(prepared.upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": prepared.upload.uploadContentType },
    body: uploadBody,
  });

  if (!uploadResponse.ok) {
    const detail = await uploadResponse.text().catch(() => "");
    console.error("[uploadAudioDirectly] PUT failed", uploadResponse.status, detail);
    throw new Error(
      `The audio upload could not be completed (${uploadResponse.status}${detail ? `: ${detail.slice(0, 200)}` : ""})`
    );
  }

  onProgress?.(65);
  return { key: prepared.upload.key, mimeType: prepared.upload.mimeType };
}

export type PreparedAudioUpload = {
  key: string;
  mimeType: string;
  uploadUrl: string;
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
  const uploadResponse = await fetch(prepared.upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": prepared.upload.mimeType },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error("The audio upload could not be completed");
  }

  onProgress?.(65);
  return { key: prepared.upload.key, mimeType: prepared.upload.mimeType };
}

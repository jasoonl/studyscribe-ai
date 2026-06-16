import { trpc } from "@/lib/trpc";
import { useState } from "react";

export function useRecordingUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadRecording = async (
    audioBuffer: Buffer,
    title: string,
    audience: "student" | "professional",
    description?: string,
    duration?: number
  ) => {
    try {
      setIsUploading(true);
      setError(null);

      // Call the create recording mutation
      const recording = await trpc.recordings.create.useMutation().mutateAsync({
        title,
        description,
        audience,
        audioBuffer,
        duration,
      });

      return recording;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload recording";
      setError(message);
      throw err;
    } finally {
      setIsUploading(false);
    }
  };

  return { uploadRecording, isUploading, error };
}

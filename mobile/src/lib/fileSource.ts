import { File, UploadType } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { contentTypeFor, type UploadIo, type UploadSource } from "./upload";

/** A file on the phone (a recording, or something picked) as an upload source. */
export function fileSource(uri: string, name: string, declaredType?: string | null, knownSize?: number | null): UploadSource & { uri: string } {
  const file = new File(uri);
  // The real size on disk wins: the upload URL signs the exact Content-Length, so a stale picker size would fail it.
  const size = file.size && file.size > 0 ? file.size : knownSize && knownSize > 0 ? knownSize : 0;
  return {
    uri,
    name,
    mimeType: contentTypeFor(name, declaredType),
    size,
    async readChunk(offset, length) {
      const handle = file.open();
      try {
        handle.offset = offset;
        return handle.readBytes(length);
      } finally {
        handle.close();
      }
    },
    readBase64: () => file.base64(),
  };
}

/** Network and file IO for uploadAudio on iOS and Android. */
export function nativeUploadIo(apiBase: string, token: string | null, source: { uri: string }): UploadIo {
  return {
    apiBase,
    token,
    fetch: (url, init) => expoFetch(url, init as never) as unknown as Promise<Response>,
    async putFile(url, headers, onProgress) {
      // A native upload task: on iOS it keeps going if the app is backgrounded mid-upload.
      const result = await new File(source.uri).upload(url, {
        httpMethod: "PUT",
        uploadType: UploadType.BINARY_CONTENT,
        headers,
        onProgress: ({ bytesSent }) => onProgress(bytesSent),
      });
      return { status: result.status, body: result.body };
    },
  };
}

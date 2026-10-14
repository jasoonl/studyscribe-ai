import { contentTypeFor, type UploadIo, type UploadSource } from "./upload";

/**
 * Web preview (react-native-web) version: the picked or recorded file is a
 * blob: URL. Only used to test the app in a browser.
 */
export function fileSource(uri: string, name: string, declaredType?: string | null, knownSize?: number | null): UploadSource & { uri: string } {
  let blob: Promise<Blob> | null = null;
  const load = () => (blob ??= fetch(uri).then((response) => response.blob()));
  return {
    uri,
    name,
    mimeType: contentTypeFor(name, declaredType),
    size: knownSize ?? 0,
    async readChunk(offset, length) {
      return new Uint8Array(await (await load()).slice(offset, offset + length).arrayBuffer());
    },
    async readBase64() {
      const buffer = new Uint8Array(await (await load()).arrayBuffer());
      let binary = "";
      for (let index = 0; index < buffer.length; index += 0x8000) {
        binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
      }
      return btoa(binary);
    },
  };
}

export function nativeUploadIo(apiBase: string, token: string | null, source: { uri: string }): UploadIo {
  return {
    apiBase,
    token,
    fetch: (url, init) => fetch(url, init),
    async putFile(url, headers, onProgress) {
      const body = await (await fetch(source.uri)).blob();
      const response = await fetch(url, { method: "PUT", headers, body });
      onProgress(body.size);
      return { status: response.status, body: response.ok ? "" : await response.text() };
    },
  };
}

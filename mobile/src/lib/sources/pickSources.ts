import * as DocumentPicker from "expo-document-picker";
import { SOURCE_EXTENSIONS } from "@shared/const";

export type PickedSource = { uri: string; name: string; size: number };

/** Types offered to the picker, built from the extensions the server accepts. iOS reports .md loosely, so the file name is the real gate afterwards. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

export function pickerTypes(): string[] {
  const types = new Set<string>();
  for (const extension of Object.keys(SOURCE_EXTENSIONS)) {
    const type = TYPE_BY_EXTENSION[extension];
    if (type) types.add(type);
  }
  // Files with an unknown type (often .md) arrive as a generic one.
  types.add("application/octet-stream");
  return Array.from(types);
}

/** Opens the system file picker. Returns nothing when cancelled. */
export async function pickSources(): Promise<PickedSource[]> {
  const result = await DocumentPicker.getDocumentAsync({ type: pickerTypes(), copyToCacheDirectory: true, multiple: true });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, size: asset.size ?? 0 }));
}

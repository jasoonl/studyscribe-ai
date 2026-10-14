import { Platform, Share } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Saves the account export as a JSON file and opens the share sheet (Files, Mail, AirDrop, Drive). */
export async function shareExport(data: unknown) {
  const json = JSON.stringify(data, null, 2);
  const name = `studyscribe-export-${new Date().toISOString().slice(0, 10)}.json`;
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.write(json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Your StudyScribe data", UTI: "public.json" });
  } else {
    await Share.share({ title: name, message: json.slice(0, 100_000) });
  }
}

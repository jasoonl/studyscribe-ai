import { useState } from "react";
import { View } from "react-native";
import { FileText, StickyNote } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { MIN_NOTES_CHARS, notesProblem } from "@/lib/sources/notes";
import { pickSources } from "@/lib/sources/pickSources";
import { useSourceUploads } from "@/lib/sources/UploadsProvider";
import { useTheme } from "@/theme/tokens";

/** Two ways in: choose files, or paste notes. Both go through the same upload queue. */
export function AddSourceSheet({ open, onClose, courseId }: { open: boolean; onClose: () => void; courseId: number }) {
  const theme = useTheme();
  const { addFiles, addNotes } = useSourceUploads();
  const [mode, setMode] = useState<"choose" | "paste">("choose");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const close = () => {
    setMode("choose");
    setTitle("");
    setText("");
    setError(null);
    onClose();
  };

  const choose = async () => {
    setPicking(true);
    try {
      const picked = await pickSources();
      if (picked.length > 0) {
        addFiles(picked, courseId);
        close();
      }
    } catch {
      setError("Could not open your files. Try again.");
    } finally {
      setPicking(false);
    }
  };

  const submitNotes = () => {
    const problem = notesProblem(text);
    if (problem) return setError(problem);
    addNotes(title, text, courseId);
    close();
  };

  return (
    <Sheet open={open} onClose={close} title={mode === "paste" ? "Paste notes" : "Add a source"} description={mode === "paste" ? undefined : "PDF, PowerPoint (.pptx), Word (.docx), .txt or .md. Up to 25MB, text files up to 2MB."}>
      {mode === "choose" ? (
        <View className="gap-3">
          <Button label="Choose files" icon={<FileText size={18} color={theme.primaryForeground} />} loading={picking} onPress={choose} />
          <Button label="Paste notes" variant="outline" icon={<StickyNote size={18} color={theme.foreground} />} onPress={() => setMode("paste")} />
          {error ? (
            <Text variant="small" className="text-destructive" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </View>
      ) : (
        <View className="gap-3">
          <Input label="Title" value={title} onChangeText={setTitle} placeholder="Chapter 4 notes" maxLength={80} returnKeyType="next" />
          <Input
            label="Notes"
            value={text}
            onChangeText={(value) => {
              setText(value);
              setError(null);
            }}
            multiline
            placeholder="Paste or type your notes"
            hint={`At least ${MIN_NOTES_CHARS} characters.`}
            error={error}
          />
          <Button label="Add notes" onPress={submitNotes} />
          <Button label="Back" variant="ghost" onPress={() => setMode("choose")} />
        </View>
      )}
    </Sheet>
  );
}

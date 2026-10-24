import { View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { Checkbox } from "@/components/ui/misc";
import type { AskMode, AskSourceSelection } from "@/lib/sources/askSources";

export type PickerSource = { id: number; title: string };

/** The wording of the "Using" chip for a selection. */
export function pickerChipText(selection: AskSourceSelection, available: number): string {
  if (selection.mode === "recordings") return "Recordings only";
  if (selection.ids.length > 0) return `${selection.ids.length} ${selection.ids.length === 1 ? "source" : "sources"}`;
  return available > 0 ? "All sources" : "No sources";
}

/** Chooses what Ask reads: sources, recordings or both, and which ready sources. */
export function AskSourcePicker({
  open,
  onClose,
  sources,
  selection,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  sources: PickerSource[];
  selection: AskSourceSelection;
  onChange: (selection: AskSourceSelection) => void;
}) {
  const allIds = sources.map((source) => source.id);
  const checked = (id: number) => selection.mode !== "recordings" && (selection.ids.length === 0 || selection.ids.includes(id));
  const activeMode = (): AskMode => (selection.mode === "recordings" ? "both" : selection.mode);

  const toggle = (id: number, on: boolean) => {
    const current = selection.mode === "recordings" ? [] : selection.ids.length === 0 ? allIds : selection.ids;
    const next = on ? Array.from(new Set([...current, id])) : current.filter((value) => value !== id);
    if (next.length === 0) onChange({ ids: [], mode: "recordings" });
    else onChange({ ids: next.length === allIds.length ? [] : next, mode: activeMode() });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ask using"
      description="Choose what StudyScribe searches for this question."
      footer={<Button label="Done" onPress={onClose} />}
    >
      <Segmented
        label="What to search"
        value={selection.mode}
        onChange={(mode) => onChange({ ...selection, mode })}
        options={[
          { value: "both", label: "Both" },
          { value: "sources", label: "Sources only" },
          { value: "recordings", label: "Recordings only" },
        ]}
      />
      <View className="flex-row gap-2">
        <Button label="Select all" variant="ghost" size="sm" className="min-h-[44px]" onPress={() => onChange({ ids: [], mode: activeMode() })} />
        <Button label="Clear" variant="ghost" size="sm" className="min-h-[44px]" onPress={() => onChange({ ids: [], mode: "recordings" })} />
      </View>
      {selection.mode === "recordings" ? <Text variant="muted">Sources are not used. Pick a source or Select all to include them.</Text> : null}
      <View>
        {sources.map((source) => (
          <Checkbox key={source.id} checked={checked(source.id)} onChange={(on) => toggle(source.id, on)} label={source.title} />
        ))}
      </View>
    </Sheet>
  );
}

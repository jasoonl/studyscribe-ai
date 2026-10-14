import { useState } from "react";
import { Pressable, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import { TRANSCRIPTION_LANGUAGES } from "@shared/languages";
import { resolveCourseColor } from "@shared/courseColors";
import { Input } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

export type RecordingOptionsValue = {
  title: string;
  language: string;
  courseId: number | null;
  vocabulary: string;
};

export const emptyOptions = (title = ""): RecordingOptionsValue => ({ title, language: "auto", courseId: null, vocabulary: "" });

/** One term per line or comma, at most six words each (same rule as server/vocabularyInput.ts). */
export function parseTerms(input: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const piece of input.split(/[\n,;]+/)) {
    const term = piece.replace(/\s+/g, " ").trim();
    if (term.length < 2 || term.length > 80 || term.split(" ").length > 6) continue;
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= 200) break;
  }
  return terms;
}

function PickerField({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <View className="gap-1.5">
      <Text variant="label">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityHint="Opens a list to choose from"
        onPress={onPress}
        className="min-h-[48px] flex-row items-center justify-between rounded-lg border border-input bg-card px-3.5 active:bg-muted"
      >
        <Text variant="body" numberOfLines={1} className="flex-1">
          {value}
        </Text>
        <ChevronDown size={18} color={theme.mutedForeground} />
      </Pressable>
    </View>
  );
}

function OptionRow({ label, selected, onPress, dot }: { label: string; selected: boolean; onPress: () => void; dot?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-[48px] flex-row items-center gap-3 rounded-lg px-3 active:bg-muted"
    >
      {dot ? <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dot }} /> : null}
      <Text variant="body" className="flex-1">
        {label}
      </Text>
      {selected ? <Check size={18} color={theme.primary} /> : null}
    </Pressable>
  );
}

/** Title, course, spoken language and words to listen for: the options the web offers before transcribing. */
export function RecordingOptions({ value, onChange, showTitle = true }: { value: RecordingOptionsValue; onChange: (value: RecordingOptionsValue) => void; showTitle?: boolean }) {
  const theme = useTheme();
  const [sheet, setSheet] = useState<"language" | "course" | null>(null);
  const courses = trpc.courses.list.useQuery(undefined, { retry: false });
  const courseList = ((courses.data ?? []) as { id: number; name: string; color: string | null; archived?: unknown }[]).filter((course) => !course.archived);
  const languageLabel = value.language === "auto" ? "Detect automatically" : TRANSCRIPTION_LANGUAGES.find((language) => language.code === value.language)?.label ?? value.language;
  const courseLabel = value.courseId ? courseList.find((course) => course.id === value.courseId)?.name ?? "Course" : "No course";

  return (
    <View className="gap-4">
      {showTitle ? <Input label="Title" value={value.title} onChangeText={(title) => onChange({ ...value, title })} placeholder="Week 3: Cell respiration" maxLength={255} /> : null}
      {courseList.length > 0 ? <PickerField label="Course" value={courseLabel} onPress={() => setSheet("course")} /> : null}
      <PickerField label="Spoken language" value={languageLabel} onPress={() => setSheet("language")} />
      <Input
        label="Words to listen for (optional)"
        value={value.vocabulary}
        onChangeText={(vocabulary) => onChange({ ...value, vocabulary })}
        placeholder="Names, course terms, acronyms"
        hint="One per line or separated by commas. Your standing list in Settings is used too."
        multiline
      />

      <Sheet open={sheet === "language"} onClose={() => setSheet(null)} title="Spoken language" description="Leave it on automatic unless the transcript comes out in the wrong language.">
        <View>
          <OptionRow label="Detect automatically" selected={value.language === "auto"} onPress={() => (onChange({ ...value, language: "auto" }), setSheet(null))} />
          {TRANSCRIPTION_LANGUAGES.map((language) => (
            <OptionRow key={language.code} label={language.label} selected={value.language === language.code} onPress={() => (onChange({ ...value, language: language.code }), setSheet(null))} />
          ))}
        </View>
      </Sheet>
      <Sheet open={sheet === "course"} onClose={() => setSheet(null)} title="Course">
        <View>
          <OptionRow label="No course" selected={value.courseId === null} onPress={() => (onChange({ ...value, courseId: null }), setSheet(null))} />
          {courseList.map((course) => (
            <OptionRow
              key={course.id}
              label={course.name}
              dot={theme.course[resolveCourseColor(course.color)]}
              selected={value.courseId === course.id}
              onPress={() => (onChange({ ...value, courseId: course.id }), setSheet(null))}
            />
          ))}
        </View>
      </Sheet>
    </View>
  );
}

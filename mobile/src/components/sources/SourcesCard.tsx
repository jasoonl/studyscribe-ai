import { router } from "expo-router";
import { ChevronRight, FileText } from "lucide-react-native";
import { Text } from "@/components/ui/Text";
import { PressableCard } from "@/components/ui/Card";
import { View } from "react-native";
import { useSourcesAvailable } from "@/lib/sources/useSourcesAvailable";
import { useTheme } from "@/theme/tokens";

/** The course screen's entry to its sources. Renders nothing until sources are known to be available. */
export function SourcesCard({ courseId }: { courseId: number }) {
  const theme = useTheme();
  const { available, sources } = useSourcesAvailable(courseId);
  if (!available) return null;
  const ready = sources.filter((source) => source.status === "ready").length;
  const summary = sources.length === 0 ? "Add slides, PDFs and notes" : `${ready} ready`;
  return (
    <PressableCard
      onPress={() => router.push(`/course-sources/${courseId}`)}
      accessibilityLabel={`Study sources, ${summary}`}
      accessibilityHint="Opens this course's study sources"
      className="flex-row items-center gap-3"
    >
      <View className="h-8 w-8 items-center justify-center rounded-lg bg-secondary">
        <FileText size={18} color={theme.primary} />
      </View>
      <View className="flex-1">
        <Text variant="subheading">Study sources</Text>
        <Text variant="muted">{summary}</Text>
      </View>
      <ChevronRight size={18} color={theme.mutedForeground} />
    </PressableCard>
  );
}

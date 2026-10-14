import { memo } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { resolveCourseColor } from "@shared/courseColors";
import { Badge } from "@/components/ui/Badge";
import { PressableCard } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { formatDate, formatRecordingDuration } from "@/lib/format";
import { useTheme } from "@/theme/tokens";

export type RecordingListItem = {
  id: number;
  title: string;
  duration: number | null;
  status: string | null;
  createdAt: Date | string;
  courseId?: number | null;
};

export type CourseSummary = { id: number; name: string; color: string | null };

export function statusBadge(status: string | null) {
  if (status === "processing") return <Badge label="Transcribing" tone="primary" />;
  if (status === "failed") return <Badge label="Needs attention" tone="danger" />;
  return null;
}

export const RecordingRow = memo(function RecordingRow({ recording, course }: { recording: RecordingListItem; course?: CourseSummary }) {
  const theme = useTheme();
  const meta = [formatDate(recording.createdAt), formatRecordingDuration(recording.duration), course?.name].filter(Boolean).join(" · ");
  return (
    <PressableCard
      onPress={() => router.push(`/recording/${recording.id}`)}
      accessibilityLabel={`${recording.title}. ${meta}${recording.status === "processing" ? ". Transcribing" : recording.status === "failed" ? ". Needs attention" : ""}`}
      accessibilityHint="Opens the recording"
      className="flex-row items-center gap-3"
    >
      <View className="flex-1 gap-1.5">
        <Text variant="subheading" numberOfLines={2}>
          {recording.title}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          {course ? <View className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.course[resolveCourseColor(course.color)] }} /> : null}
          <Text variant="muted" numberOfLines={1} className="shrink">
            {meta}
          </Text>
        </View>
        {statusBadge(recording.status)}
      </View>
      <ChevronRight size={18} color={theme.mutedForeground} />
    </PressableCard>
  );
});

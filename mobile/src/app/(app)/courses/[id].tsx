import { View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { resolveCourseColor } from "@shared/courseColors";
import { SourcesCard } from "@/components/sources/SourcesCard";
import { RecordingRow } from "@/components/RecordingRow";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, trpc } from "@/lib/trpc";
import { useProcessingPoller } from "@/lib/useProcessingPoller";
import { useTheme } from "@/theme/tokens";

export default function CourseScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const theme = useTheme();
  const toast = useToast();
  const course = trpc.courses.get.useQuery({ id });
  const recordings = trpc.recordings.list.useQuery({ courseId: id });
  const pack = trpc.examPacks.create.useMutation({
    onSuccess: (result) => router.push(`/exam-packs/${(result as { id: number }).id}`),
    onError: (error) => toast.show(errorMessage(error), "error"),
  });
  const items = recordings.data ?? [];
  useProcessingPoller(items.filter((item) => item.status === "processing").map((item) => item.id));
  const completed = items.filter((item) => item.status === "completed").length;

  return (
    <Screen edges={["bottom"]} refreshing={recordings.isRefetching} onRefresh={() => recordings.refetch()}>
      <Stack.Screen options={{ title: course.data?.name ?? "Course" }} />
      {course.data ? (
        <View className="flex-row items-center gap-2">
          <View className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.course[resolveCourseColor(course.data.color)] }} />
          <Text variant="title" className="flex-1">
            {course.data.name}
          </Text>
        </View>
      ) : null}
      {course.data?.term ? <Text variant="muted">{course.data.term}</Text> : null}
      {completed > 0 ? (
        <Button label="Make an exam pack from this course" variant="outline" loading={pack.isPending} onPress={() => pack.mutate({ courseId: id })} />
      ) : null}
      <SourcesCard courseId={id} />
      {recordings.isLoading ? (
        <SkeletonList rows={3} />
      ) : recordings.error ? (
        <ErrorState message={errorMessage(recordings.error)} onRetry={() => recordings.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No recordings in this course" body="File a recording here when you add it, from the Course field." />
      ) : (
        <View className="gap-3">
          {items.map((recording) => (
            <RecordingRow key={recording.id} recording={recording} />
          ))}
        </View>
      )}
    </Screen>
  );
}

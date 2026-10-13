import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Bell, FileStack, Inbox, Search, Trash2, Users } from "lucide-react-native";
import { resolveCourseColor } from "@shared/courseColors";
import { RecordingRow, type CourseSummary } from "@/components/RecordingRow";
import { RecoveredRecordingBanner } from "@/components/RecoveredRecordingBanner";
import { IconButton } from "@/components/ui/Button";
import { SectionTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState, ErrorState, ListGroup, ListRow, SkeletonList } from "@/components/ui/misc";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { errorMessage, trpc } from "@/lib/trpc";
import { useProcessingPoller } from "@/lib/useProcessingPoller";
import { useTheme } from "@/theme/tokens";

export default function LibraryScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [courseId, setCourseId] = useState<number | null>(null);
  const recordings = trpc.recordings.list.useQuery();
  const courses = trpc.courses.list.useQuery(undefined, { retry: false });
  const unread = trpc.userNotifications.unreadCount.useQuery(undefined, { refetchInterval: 60_000 });

  const courseList: CourseSummary[] = useMemo(
    () => ((courses.data ?? []) as { id: number; name: string; color: string | null; archivedAt?: unknown }[]).filter((course) => !course.archivedAt),
    [courses.data],
  );
  const courseById = useMemo(() => new Map(courseList.map((course) => [course.id, course])), [courseList]);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (recordings.data ?? []).filter((recording) => {
      if (courseId !== null && recording.courseId !== courseId) return false;
      return !needle || recording.title.toLowerCase().includes(needle);
    });
  }, [recordings.data, query, courseId]);

  const processing = useMemo(() => (recordings.data ?? []).filter((recording) => recording.status === "processing").map((recording) => recording.id), [recordings.data]);
  useProcessingPoller(processing);

  const unreadCount = Number((unread.data as { count?: number } | number | undefined) && typeof unread.data === "object" ? (unread.data as { count: number }).count : unread.data ?? 0);

  return (
    <Screen refreshing={recordings.isRefetching} onRefresh={() => recordings.refetch()}>
      <ScreenTitle
        title="Library"
        action={
          <View>
            <IconButton
              label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
              onPress={() => router.push("/notifications")}
              icon={<Bell size={22} color={theme.foreground} />}
            />
            {unreadCount > 0 ? <View className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-destructive" /> : null}
          </View>
        }
      />

      <RecoveredRecordingBanner />

      <View className="relative justify-center">
        <Input value={query} onChangeText={setQuery} placeholder="Search recordings" accessibilityLabel="Search recordings" returnKeyType="search" className="flex-1" style={{ paddingLeft: 40 }} />
        <View pointerEvents="none" className="absolute left-3.5">
          <Search size={18} color={theme.mutedForeground} />
        </View>
      </View>

      {courseList.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-4" accessibilityLabel="Filter by course">
          <CourseChip label="All" selected={courseId === null} onPress={() => setCourseId(null)} />
          {courseList.map((course) => (
            <CourseChip
              key={course.id}
              label={course.name}
              color={theme.course[resolveCourseColor(course.color)]}
              selected={courseId === course.id}
              onPress={() => setCourseId(courseId === course.id ? null : course.id)}
              onLongPress={() => router.push(`/courses/${course.id}`)}
            />
          ))}
        </ScrollView>
      ) : null}

      {courseId !== null ? (
        <Pressable accessibilityRole="link" onPress={() => router.push(`/courses/${courseId}`)} className="self-start py-1">
          <Text variant="label" className="text-primary">
            Open course page
          </Text>
        </Pressable>
      ) : null}

      {recordings.isLoading ? (
        <SkeletonList rows={5} />
      ) : recordings.error ? (
        <ErrorState message={errorMessage(recordings.error)} onRetry={() => recordings.refetch()} />
      ) : items.length === 0 ? (
        query || courseId !== null ? (
          <EmptyState title="Nothing matches" body="Try another search or course." />
        ) : (
          <EmptyState
            icon={<Inbox size={22} color={theme.primary} />}
            title="No recordings yet"
            body="Record a lecture or meeting, upload a file, or import a link. Transcripts and study tools appear here."
            action={{ label: "Start recording", onPress: () => router.push("/record") }}
          />
        )
      ) : (
        <View className="gap-3">
          {items.map((recording) => (
            <RecordingRow key={recording.id} recording={recording} course={recording.courseId ? courseById.get(recording.courseId) : undefined} />
          ))}
        </View>
      )}

      <SectionTitle>More</SectionTitle>
      <ListGroup>
        <ListRow title="Exam packs" subtitle="Guides and practice exams across recordings" icon={<FileStack size={18} color={theme.primary} />} onPress={() => router.push("/exam-packs")} />
        <ListRow title="Shared with me" icon={<Users size={18} color={theme.primary} />} onPress={() => router.push("/shared-with-me")} />
        <ListRow title="Trash" subtitle="Deleted recordings, kept until you empty it" icon={<Trash2 size={18} color={theme.primary} />} onPress={() => router.push("/trash")} />
      </ListGroup>
    </Screen>
  );
}

function CourseChip({ label, color, selected, onPress, onLongPress }: { label: string; color?: string; selected: boolean; onPress: () => void; onLongPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityHint={onLongPress ? "Long press to open the course" : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      className={cn("min-h-[36px] flex-row items-center gap-2 rounded-full border px-3.5", selected ? "border-primary bg-secondary" : "border-border bg-card")}
    >
      {color ? <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} /> : null}
      <Text variant="label" className={selected ? "text-secondary-foreground" : "text-foreground"}>
        {label}
      </Text>
    </Pressable>
  );
}

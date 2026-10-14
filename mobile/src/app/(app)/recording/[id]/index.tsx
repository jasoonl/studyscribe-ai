import { useMemo, useState } from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Bookmark, Ellipsis, Share2 } from "lucide-react-native";
import { TRANSCRIPTION_LANGUAGES } from "@shared/languages";
import { resolveCourseColor } from "@shared/courseColors";
import { PlayerControls, PlayerProvider, usePlayer } from "@/components/AudioPlayer";
import { NotesPanel } from "@/components/detail/NotesPanel";
import { ShareSheet } from "@/components/detail/ShareSheet";
import { StudyPanel } from "@/components/detail/StudyPanel";
import { TasksPanel } from "@/components/detail/TasksPanel";
import { RecordingOptions, emptyOptions, parseTerms, type RecordingOptionsValue } from "@/components/RecordingOptions";
import { statusBadge } from "@/components/RecordingRow";
import { TranscriptView, type Segment } from "@/components/TranscriptView";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState, ProgressBar, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatRecordingDuration, formatTimestamp } from "@/lib/format";
import { errorMessage, trpc } from "@/lib/trpc";
import { useProcessingPoller } from "@/lib/useProcessingPoller";
import { useTheme } from "@/theme/tokens";

type Tab = "transcript" | "notes" | "study" | "tasks";

export default function RecordingDetailScreen() {
  const params = useLocalSearchParams<{ id: string; t?: string; q?: string }>();
  const id = Number(params.id);
  const recording = trpc.recordings.get.useQuery({ id }, { enabled: Number.isFinite(id) });
  const startAt = params.t ? Number(params.t) : undefined;

  if (recording.isLoading) {
    return (
      <Screen edges={["bottom"]}>
        <SkeletonList rows={3} />
      </Screen>
    );
  }
  if (recording.error || !recording.data) {
    return (
      <Screen edges={["bottom"]}>
        <ErrorState message={recording.error ? errorMessage(recording.error) : "Recording not found."} onRetry={() => recording.refetch()} />
      </Screen>
    );
  }
  const data = recording.data;
  if (data.status !== "completed") return <PendingRecording recording={data} />;
  return (
    <PlayerProvider recordingId={id} title={data.title} knownDuration={data.duration} startAt={Number.isFinite(startAt) ? startAt : undefined}>
      <CompletedRecording recording={data} initialQuery={params.q} />
    </PlayerProvider>
  );
}

type RecordingData = { id: number; title: string; duration: number | null; status: string | null; createdAt: Date | string; courseId?: number | null };

function Header({ recording }: { recording: RecordingData }) {
  const theme = useTheme();
  const courses = trpc.courses.list.useQuery(undefined, { retry: false });
  const course = ((courses.data ?? []) as { id: number; name: string; color: string | null }[]).find((item) => item.id === recording.courseId);
  return (
    <View className="gap-2">
      <Text variant="title">{recording.title}</Text>
      <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Text variant="muted">{[formatDate(recording.createdAt), formatRecordingDuration(recording.duration)].join(" · ")}</Text>
        {course ? (
          <Pressable accessibilityRole="link" accessibilityLabel={`Course ${course.name}`} onPress={() => router.push(`/courses/${course.id}`)} className="flex-row items-center gap-1.5">
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.course[resolveCourseColor(course.color)] }} />
            <Text variant="muted">{course.name}</Text>
          </Pressable>
        ) : null}
      </View>
      {statusBadge(recording.status)}
    </View>
  );
}

/** Still transcribing, or failed: poll every 3s (drives completion when no webhook is set), or offer a retry. */
function PendingRecording({ recording }: { recording: RecordingData }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [options, setOptions] = useState<RecordingOptionsValue>(() => emptyOptions(recording.title));
  useProcessingPoller(recording.status === "processing" ? [recording.id] : [], (_, status) => {
    if (status === "completed") toast.show("Transcript ready.", "success");
  });
  const retry = trpc.recordings.retryTranscription.useMutation({
    onSuccess: () => {
      utils.recordings.get.invalidate({ id: recording.id });
      utils.recordings.list.invalidate();
      toast.show("Transcribing again.", "success");
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ title: "" }} />
      <Header recording={recording} />
      {recording.status === "processing" ? (
        <Card className="gap-3">
          <Text variant="subheading">Transcribing</Text>
          <Text variant="muted">This usually takes a few minutes, about a fifth of the recording's length. You can leave this screen; we'll send a notification when it's ready.</Text>
          <ProgressBar value={0.35} label="Transcription in progress" />
        </Card>
      ) : (
        <Card className="gap-4">
          <View className="gap-1">
            <Text variant="subheading">This recording couldn't be transcribed</Text>
            <Text variant="muted">Try again, picking the spoken language if it was detected wrongly. The audio is kept, so there's nothing to upload again.</Text>
          </View>
          <RecordingOptions value={options} onChange={setOptions} showTitle={false} />
          <Button
            label="Try again"
            loading={retry.isPending}
            onPress={() => {
              const terms = parseTerms(options.vocabulary);
              retry.mutate({ id: recording.id, language: options.language === "auto" ? undefined : (options.language as never), keyterms: terms.length ? terms : undefined });
            }}
          />
        </Card>
      )}
    </Screen>
  );
}

function CompletedRecording({ recording, initialQuery }: { recording: RecordingData; initialQuery?: string }) {
  const theme = useTheme();
  const toast = useToast();
  const utils = trpc.useUtils();
  const player = usePlayer();
  const [tab, setTab] = useState<Tab>("transcript");
  const [sharing, setSharing] = useState(false);
  const transcript = trpc.transcription.get.useQuery({ recordingId: recording.id });
  const insights = trpc.insights.get.useQuery({ recordingId: recording.id }, { retry: false });
  const bookmarks = trpc.bookmarks.list.useQuery({ recordingId: recording.id }, { retry: false });
  const remove = trpc.recordings.delete.useMutation({
    onSuccess: () => {
      utils.recordings.list.invalidate();
      toast.show("Moved to Trash.", "success");
      router.back();
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  const segments = useMemo(() => (Array.isArray(transcript.data?.segments) ? (transcript.data!.segments as Segment[]) : []), [transcript.data]);
  const chapters = (insights.data?.chapters ?? []) as { start: number; title: string; summary: string }[];
  const keyTerms = insights.data?.keyTerms?.terms ?? [];
  const marks = ((bookmarks.data ?? []) as { id: number; atSeconds: number; label?: string | null }[]).slice().sort((a, b) => a.atSeconds - b.atSeconds);
  const language = TRANSCRIPTION_LANGUAGES.find((item) => item.code === transcript.data?.language)?.label;

  function more() {
    const confirmDelete = () =>
      Alert.alert("Move to Trash?", "You can restore it from Trash until you empty it.", [
        { text: "Cancel", style: "cancel" },
        { text: "Move to Trash", style: "destructive", onPress: () => remove.mutate({ id: recording.id }) },
      ]);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options: ["Share", "Move to Trash", "Cancel"], destructiveButtonIndex: 1, cancelButtonIndex: 2 }, (index) => {
        if (index === 0) setSharing(true);
        if (index === 1) confirmDelete();
      });
    } else {
      Alert.alert(recording.title, undefined, [
        { text: "Share", onPress: () => setSharing(true) },
        { text: "Move to Trash", style: "destructive", onPress: confirmDelete },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }

  return (
    <Screen edges={["bottom"]} refreshing={transcript.isRefetching} onRefresh={() => (transcript.refetch(), insights.refetch())}>
      <Stack.Screen
        options={{
          title: "",
          headerRight: () => (
            <View className="flex-row">
              <IconButton label="Share" onPress={() => setSharing(true)} icon={<Share2 size={20} color={theme.primary} />} />
              <IconButton label="More actions" onPress={more} icon={<Ellipsis size={22} color={theme.primary} />} />
            </View>
          ),
        }}
      />
      <Header recording={recording} />
      <PlayerControls />

      {chapters.length ? (
        <View className="gap-1 rounded-xl border border-border bg-card p-2">
          <Text variant="label" className="px-2 pt-1 text-muted-foreground">
            Chapters
          </Text>
          {chapters.map((chapter) => (
            <Pressable
              key={`${chapter.start}-${chapter.title}`}
              accessibilityRole="button"
              accessibilityLabel={`Chapter at ${formatTimestamp(chapter.start)}: ${chapter.title}`}
              onPress={() => player?.seek(chapter.start, true)}
              className="flex-row gap-3 rounded-lg px-2 py-2 active:bg-muted"
            >
              <Text variant="caption" className="w-12 pt-0.5 text-primary" style={{ fontVariant: ["tabular-nums"] }}>
                {formatTimestamp(chapter.start)}
              </Text>
              <View className="flex-1">
                <Text variant="small" className="font-medium">
                  {chapter.title}
                </Text>
                {chapter.summary ? <Text variant="caption">{chapter.summary}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {marks.length ? (
        <View className="flex-row flex-wrap gap-2" accessibilityLabel="Marked moments">
          {marks.map((mark) => (
            <Pressable
              key={mark.id}
              accessibilityRole="button"
              accessibilityLabel={`Marked moment at ${formatTimestamp(mark.atSeconds)}`}
              onPress={() => player?.seek(mark.atSeconds, true)}
              className="flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5"
            >
              <Bookmark size={14} color={theme.primary} />
              <Text variant="caption" className="text-foreground">
                {mark.label || formatTimestamp(mark.atSeconds)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Segmented
        label="Recording sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "transcript", label: "Transcript" },
          { value: "notes", label: "Notes" },
          { value: "study", label: "Study" },
          { value: "tasks", label: "Tasks" },
        ]}
      />

      {tab === "transcript" ? (
        transcript.isLoading ? (
          <SkeletonList rows={4} />
        ) : transcript.data ? (
          <View className="gap-2">
            {language ? <Text variant="caption">Language: {language}</Text> : null}
            <TranscriptView recordingId={recording.id} title={recording.title} segments={segments} fullText={transcript.data.fullText} canEdit keyTerms={keyTerms} initialQuery={initialQuery} />
          </View>
        ) : (
          <ErrorState message="The transcript could not be loaded." onRetry={() => transcript.refetch()} />
        )
      ) : tab === "notes" ? (
        <NotesPanel recordingId={recording.id} title={recording.title} />
      ) : tab === "study" ? (
        <StudyPanel recordingId={recording.id} hasKeyTerms={keyTerms.length > 0} hasChapters={chapters.length > 0} />
      ) : (
        <TasksPanel recordingId={recording.id} />
      )}

      <ShareSheet recordingId={recording.id} title={recording.title} open={sharing} onClose={() => setSharing(false)} />
    </Screen>
  );
}

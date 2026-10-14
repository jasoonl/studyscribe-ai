import { useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { PlayerControls, PlayerProvider } from "@/components/AudioPlayer";
import { Markdown } from "@/components/Markdown";
import { TranscriptView, type Segment } from "@/components/TranscriptView";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { Text } from "@/components/ui/Text";
import { formatDate, formatRecordingDuration } from "@/lib/format";
import { errorMessage, trpc } from "@/lib/trpc";

/** A recording someone shared with you: player, transcript and the owner's notes (edit role can fix the transcript). */
export default function SharedRecordingScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [tab, setTab] = useState<"transcript" | "notes">("transcript");
  const bundle = trpc.sharing.getSharedWithMe.useQuery({ recordingId: id });

  if (bundle.isLoading) {
    return (
      <Screen edges={["bottom"]}>
        <SkeletonList rows={3} />
      </Screen>
    );
  }
  if (bundle.error || !bundle.data) {
    return (
      <Screen edges={["bottom"]}>
        <ErrorState message={bundle.error ? errorMessage(bundle.error) : "Not found."} onRetry={() => bundle.refetch()} />
      </Screen>
    );
  }
  const { recording, transcript, studyNotes, role } = bundle.data as unknown as {
    recording: { id: number; title: string; duration: number | null; createdAt: Date | string };
    transcript: { fullText: string; segments: unknown } | null;
    studyNotes: { id: number; content: string }[];
    role: string;
  };
  const segments = Array.isArray(transcript?.segments) ? (transcript!.segments as Segment[]) : [];

  return (
    <PlayerProvider recordingId={recording.id} title={recording.title} knownDuration={recording.duration}>
      <Screen edges={["bottom"]}>
        <Stack.Screen options={{ title: "Shared with you" }} />
        <View className="gap-1">
          <Text variant="title">{recording.title}</Text>
          <Text variant="muted">{[formatDate(recording.createdAt), formatRecordingDuration(recording.duration)].join(" · ")}</Text>
        </View>
        <PlayerControls />
        <Segmented label="Sections" value={tab} onChange={setTab} options={[{ value: "transcript", label: "Transcript" }, { value: "notes", label: "Notes" }]} />
        {tab === "transcript" ? (
          transcript ? (
            <TranscriptView recordingId={recording.id} title={recording.title} segments={segments} fullText={transcript.fullText} canEdit={role === "edit"} />
          ) : (
            <EmptyState title="No transcript yet" />
          )
        ) : studyNotes.length ? (
          studyNotes.map((note) => (
            <Card key={note.id}>
              <Markdown source={note.content} />
            </Card>
          ))
        ) : (
          <EmptyState title="No notes shared" />
        )}
      </Screen>
    </PlayerProvider>
  );
}

import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { FileStack } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { PressableCard } from "@/components/ui/Card";
import { Checkbox, EmptyState, ErrorState, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

const MAX_RECORDINGS = 12;

export default function ExamPacksScreen() {
  const theme = useTheme();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<number[]>([]);
  const packs = trpc.examPacks.list.useQuery();
  const recordings = trpc.recordings.list.useQuery(undefined, { enabled: picking });
  const create = trpc.examPacks.create.useMutation({
    onSuccess: (result) => {
      setPicking(false);
      setChosen([]);
      router.push(`/exam-packs/${(result as { id: number }).id}`);
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });
  const data = packs.data as { available: boolean; packs: { id: number; title: string; recordingCount: number; questionCount: number; lastScore: number | null; createdAt: Date | string }[] } | undefined;
  const finished = (recordings.data ?? []).filter((recording) => recording.status === "completed");

  return (
    <Screen edges={["bottom"]} refreshing={packs.isRefetching} onRefresh={() => packs.refetch()}>
      <Text variant="muted">A study guide and a practice exam built from several recordings, up to {MAX_RECORDINGS}, or a whole course.</Text>
      <Button label="New exam pack" onPress={() => setPicking(true)} />
      {packs.isLoading ? (
        <SkeletonList rows={2} />
      ) : packs.error ? (
        <ErrorState message={errorMessage(packs.error)} onRetry={() => packs.refetch()} />
      ) : !data?.packs.length ? (
        <EmptyState icon={<FileStack size={22} color={theme.primary} />} title="No exam packs yet" body="Make one before a test to revise everything at once." />
      ) : (
        <View className="gap-3">
          {data.packs.map((pack) => (
            <PressableCard key={pack.id} accessibilityLabel={pack.title} onPress={() => router.push(`/exam-packs/${pack.id}`)} className="gap-1">
              <Text variant="subheading">{pack.title}</Text>
              <Text variant="muted">
                {[formatDate(pack.createdAt), `${pack.recordingCount} recordings`, pack.questionCount ? `${pack.questionCount} questions` : null, pack.lastScore !== null ? `last score ${pack.lastScore}%` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </PressableCard>
          ))}
        </View>
      )}

      <Sheet
        open={picking}
        onClose={() => setPicking(false)}
        title="Choose recordings"
        description={`Pick up to ${MAX_RECORDINGS} finished recordings.`}
        footer={<Button label={`Make exam pack (${chosen.length})`} disabled={!chosen.length} loading={create.isPending} onPress={() => create.mutate({ recordingIds: chosen })} />}
      >
        {recordings.isLoading ? (
          <SkeletonList rows={3} />
        ) : finished.length === 0 ? (
          <Text variant="muted">No finished recordings yet.</Text>
        ) : (
          <View>
            {finished.map((recording) => (
              <Checkbox
                key={recording.id}
                label={recording.title}
                checked={chosen.includes(recording.id)}
                onChange={(checked) =>
                  setChosen((current) => (checked ? (current.length >= MAX_RECORDINGS ? current : [...current, recording.id]) : current.filter((item) => item !== recording.id)))
                }
              />
            ))}
          </View>
        )}
        {create.isPending ? <Text variant="caption">Writing the study guide. This can take up to a minute.</Text> : null}
      </Sheet>
    </Screen>
  );
}

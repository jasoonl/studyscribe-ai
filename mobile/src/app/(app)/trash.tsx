import { Alert, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatRecordingDuration } from "@/lib/format";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

/** Deleted recordings keep their audio until they are deleted for good here. */
export default function TrashScreen() {
  const theme = useTheme();
  const toast = useToast();
  const utils = trpc.useUtils();
  const trash = trpc.recordings.listDeleted.useQuery();
  const refresh = () => {
    utils.recordings.listDeleted.invalidate();
    utils.recordings.list.invalidate();
  };
  const onError = (error: unknown) => toast.show(errorMessage(error), "error");
  const restore = trpc.recordings.restore.useMutation({ onSuccess: () => (refresh(), toast.show("Restored.", "success")), onError });
  const purge = trpc.recordings.permanentDelete.useMutation({ onSuccess: refresh, onError });
  const empty = trpc.recordings.emptyTrash.useMutation({ onSuccess: refresh, onError });
  const items = (trash.data ?? []) as { id: number; title: string; duration: number | null; createdAt: Date | string }[];

  const confirm = (title: string, body: string, action: () => void) =>
    Alert.alert(title, body, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete forever", style: "destructive", onPress: action },
    ]);

  return (
    <Screen edges={["bottom"]} refreshing={trash.isRefetching} onRefresh={() => trash.refetch()}>
      {trash.isLoading ? (
        <SkeletonList rows={3} />
      ) : trash.error ? (
        <ErrorState message={errorMessage(trash.error)} onRetry={() => trash.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Trash2 size={22} color={theme.primary} />} title="Trash is empty" body="Recordings you delete stay here until you remove them for good." />
      ) : (
        <>
          {items.map((item) => (
            <Card key={item.id} className="gap-3">
              <View className="gap-1">
                <Text variant="subheading">{item.title}</Text>
                <Text variant="muted">{[formatDate(item.createdAt), formatRecordingDuration(item.duration)].join(" · ")}</Text>
              </View>
              <View className="flex-row gap-2">
                <Button className="flex-1" size="sm" variant="outline" label="Restore" onPress={() => restore.mutate({ id: item.id })} />
                <Button
                  className="flex-1"
                  size="sm"
                  variant="ghost"
                  label="Delete forever"
                  onPress={() => confirm("Delete forever?", "The audio, transcript and study tools are removed for good.", () => purge.mutate({ id: item.id }))}
                />
              </View>
            </Card>
          ))}
          <Button label="Empty trash" variant="destructive" loading={empty.isPending} onPress={() => confirm("Empty trash?", `${items.length} recordings are removed for good.`, () => empty.mutate())} />
        </>
      )}
    </Screen>
  );
}

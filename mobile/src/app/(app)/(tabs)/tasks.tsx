import { useMemo, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { CheckSquare } from "lucide-react-native";
import { DUE_GROUP_LABELS, groupActionItems, localIsoDate } from "@shared/actionItems";
import { ActionItemLine, type ActionItemRow } from "@/components/detail/TasksPanel";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/misc";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

type Row = ActionItemRow & { recordingTitle: string; courseId: number | null };

/** Every task found in or added to recordings, grouped by when it is due (as the web's /tasks). */
export default function TasksScreen() {
  const theme = useTheme();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [show, setShow] = useState<"open" | "all">("open");
  const query = trpc.actionItems.listAll.useQuery();
  const update = trpc.actionItems.update.useMutation({
    onSuccess: () => utils.actionItems.listAll.invalidate(),
    onError: (error) => toast.show(errorMessage(error), "error"),
  });
  const data = query.data as { available: boolean; items: Row[] } | undefined;
  const items = useMemo(() => (data?.items ?? []).filter((item) => show === "all" || !item.done), [data, show]);
  const groups = useMemo(() => groupActionItems(items.map((item) => ({ ...item, done: Boolean(item.done) })), localIsoDate(new Date())), [items]);

  return (
    <Screen refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <ScreenTitle title="Tasks" subtitle="Homework, readings and exams mentioned in your recordings." />
      <Segmented label="Show" value={show} onChange={setShow} options={[{ value: "open", label: "To do" }, { value: "all", label: "Everything" }]} />
      {query.isLoading ? (
        <SkeletonList rows={4} />
      ) : query.error ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CheckSquare size={22} color={theme.primary} />}
          title={show === "open" ? "Nothing to do" : "No tasks yet"}
          body="Open a recording and tap Find tasks on its Tasks tab. Deadlines said in class land here."
        />
      ) : (
        groups
          .filter((group) => group.items.length)
          .map((group) => (
            <View key={group.id} className="gap-2">
              <Text variant="label" className={group.id === "overdue" ? "text-destructive" : "text-muted-foreground"}>
                {DUE_GROUP_LABELS[group.id]}
              </Text>
              <Card className="gap-2">
                {group.items.map((item) => (
                  <ActionItemLine
                    key={item.id}
                    item={item as Row}
                    subtitle={(item as Row).recordingTitle}
                    onToggle={(done) => update.mutate({ id: item.id, done })}
                    onOpen={() => router.push(`/recording/${item.recordingId}${typeof item.atSeconds === "number" ? `?t=${Math.floor(item.atSeconds)}` : ""}` as never)}
                  />
                ))}
              </Card>
            </View>
          ))
      )}
    </Screen>
  );
}

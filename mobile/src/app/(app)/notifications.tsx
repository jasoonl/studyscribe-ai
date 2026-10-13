import { Pressable, View } from "react-native";
import { Stack, router } from "expo-router";
import { Bell } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

type Notification = { id: number; title: string; message: string; type: string; isRead: number | boolean; recordingId: number | null; createdAt: Date | string };

export default function NotificationsScreen() {
  const theme = useTheme();
  const utils = trpc.useUtils();
  const list = trpc.userNotifications.list.useQuery();
  const refresh = () => {
    utils.userNotifications.list.invalidate();
    utils.userNotifications.unreadCount.invalidate();
  };
  const markRead = trpc.userNotifications.markRead.useMutation({ onSuccess: refresh });
  const markAll = trpc.userNotifications.markAllRead.useMutation({ onSuccess: refresh });
  const items = (list.data ?? []) as Notification[];

  return (
    <Screen edges={["bottom"]} refreshing={list.isRefetching} onRefresh={() => list.refetch()}>
      <Stack.Screen options={{ headerRight: () => (items.some((item) => !item.isRead) ? <Button label="Mark all read" variant="ghost" size="sm" onPress={() => markAll.mutate()} /> : null) }} />
      {list.isLoading ? (
        <SkeletonList rows={4} />
      ) : list.error ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Bell size={22} color={theme.primary} />} title="No notifications" body="You'll see finished transcripts, shares and reminders here." />
      ) : (
        <View className="gap-2">
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${item.isRead ? "" : "Unread. "}${item.title}. ${item.message}`}
              onPress={() => {
                if (!item.isRead) markRead.mutate({ id: item.id });
                if (item.recordingId) router.push(`/recording/${item.recordingId}`);
              }}
              className={cn("gap-1 rounded-xl border p-4 active:bg-muted", item.isRead ? "border-border bg-card" : "border-primary/30 bg-secondary")}
            >
              <View className="flex-row items-center justify-between gap-2">
                <Text variant="subheading" className="flex-1">
                  {item.title}
                </Text>
                <Text variant="caption">{formatDate(item.createdAt)}</Text>
              </View>
              <Text variant="small">{item.message}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

import { View } from "react-native";
import { router } from "expo-router";
import { Users } from "lucide-react-native";
import { PressableCard } from "@/components/ui/Card";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { formatDate, formatRecordingDuration } from "@/lib/format";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

const ROLE_LABELS: Record<string, string> = { view: "Can view", comment: "Can comment", edit: "Can edit" };

export default function SharedWithMeScreen() {
  const theme = useTheme();
  const shared = trpc.sharing.sharedWithMe.useQuery();
  const items = (shared.data ?? []) as { recordingId: number; title: string; duration: number | null; sharedAt: Date | string; role: string; viaGroups?: string[] }[];
  return (
    <Screen edges={["bottom"]} refreshing={shared.isRefetching} onRefresh={() => shared.refetch()}>
      {shared.isLoading ? (
        <SkeletonList rows={3} />
      ) : shared.error ? (
        <ErrorState message={errorMessage(shared.error)} onRetry={() => shared.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Users size={22} color={theme.primary} />} title="Nothing shared with you yet" body="Recordings classmates or colleagues share with your email appear here." />
      ) : (
        <View className="gap-3">
          {items.map((item) => (
            <PressableCard key={item.recordingId} accessibilityLabel={`${item.title}, ${ROLE_LABELS[item.role] ?? ""}`} onPress={() => router.push(`/shared-with-me/${item.recordingId}`)} className="gap-1">
              <Text variant="subheading">{item.title}</Text>
              <Text variant="muted">
                {[formatDate(item.sharedAt), formatRecordingDuration(item.duration), ROLE_LABELS[item.role], item.viaGroups?.length ? `via ${item.viaGroups.join(", ")}` : null].filter(Boolean).join(" · ")}
              </Text>
            </PressableCard>
          ))}
        </View>
      )}
    </Screen>
  );
}

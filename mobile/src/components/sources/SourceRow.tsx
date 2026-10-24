import { memo } from "react";
import { Pressable, View } from "react-native";
import { AlertCircle, ChevronRight, MoreHorizontal } from "lucide-react-native";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { failureReasonOf, failureText, formatBytes, isRetryableReason, kindLabel, stageOf, stageWord } from "@/lib/sources/model";
import type { SourceListItem } from "@/lib/sources/useSourcesAvailable";
import { SourceProgress } from "./SourceProgress";
import { useTheme } from "@/theme/tokens";

export function sourceRowLabel(source: Pick<SourceListItem, "title" | "kind" | "status" | "flagCount">): string {
  const stage = stageOf(source.status);
  const points = stage === "ready" && source.flagCount > 0 ? `, ${source.flagCount} likely test ${source.flagCount === 1 ? "point" : "points"}` : "";
  return `${source.title}, ${kindLabel(source.kind)}, ${stageWord(stage).toLowerCase()}${points}`;
}

/** One source in the library: a tap target for the whole card, with Retry, Continue and More beside it. */
export const SourceRow = memo(function SourceRow({
  source,
  stalled,
  onOpen,
  onContinue,
  onRetry,
  onMore,
}: {
  source: SourceListItem;
  stalled: boolean;
  onOpen: () => void;
  onContinue: () => void;
  onRetry: () => void;
  onMore: () => void;
}) {
  const theme = useTheme();
  const stage = stageOf(source.status);
  const reason = stage === "failed" ? failureReasonOf(source.errorMessage, source.kind) : null;
  return (
    <View className="rounded-xl border border-border bg-card">
      <View className="flex-row items-start">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sourceRowLabel(source)}
          accessibilityHint="Opens the source"
          onPress={onOpen}
          className="min-h-[44px] flex-1 flex-row items-center gap-3 rounded-xl p-4 active:bg-muted"
        >
          <View className="flex-1 gap-1.5">
            <Text variant="subheading" numberOfLines={2}>
              {source.title}
            </Text>
            <View className="flex-row flex-wrap items-center gap-2">
              <Badge label={kindLabel(source.kind)} tone="primary" />
              <Text variant="muted">{formatBytes(source.sizeBytes)}</Text>
              {stage === "ready" ? (
                <Text variant="muted">{source.flagCount > 0 ? `${source.flagCount} likely test ${source.flagCount === 1 ? "point" : "points"}` : "Ready"}</Text>
              ) : null}
            </View>
            {stage === "waiting" || stage === "reading" || stage === "summarizing" ? (
              <SourceProgress status={source.status} partsDone={source.partsDone} partCount={source.partCount} />
            ) : null}
          </View>
          <ChevronRight size={18} color={theme.mutedForeground} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`More actions for ${source.title}`} onPress={onMore} className="h-[44px] w-[44px] items-center justify-center">
          <MoreHorizontal size={20} color={theme.mutedForeground} />
        </Pressable>
      </View>
      {reason ? (
        <View className="gap-2 px-4 pb-4">
          <View className="flex-row items-start gap-2">
            <AlertCircle size={16} color={theme.destructive} />
            <Text variant="small" className="flex-1 text-destructive">
              {failureText(reason)}
            </Text>
          </View>
          {isRetryableReason(reason) ? <Button label="Retry" variant="outline" size="sm" className="min-h-[44px] self-start" onPress={onRetry} accessibilityLabel={`Retry ${source.title}`} /> : null}
        </View>
      ) : null}
      {stalled ? (
        <View className="gap-2 px-4 pb-4">
          <Text variant="small" className="text-muted-foreground">
            This stopped before it finished.
          </Text>
          <Button label="Continue" variant="outline" size="sm" className="min-h-[44px] self-start" onPress={onContinue} accessibilityLabel={`Continue ${source.title}`} />
        </View>
      ) : null}
    </View>
  );
});

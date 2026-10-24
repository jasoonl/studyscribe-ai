import { View } from "react-native";
import { Loader } from "lucide-react-native";
import { ProgressBar } from "@/components/ui/misc";
import { Text } from "@/components/ui/Text";
import { stageOf, stageWord, summaryPercent, type SourceStatus } from "@/lib/sources/model";
import { useTheme } from "@/theme/tokens";

/** Stage word plus a bar while a source is being read and summarised. Status is never colour alone. */
export function SourceProgress({ status, partsDone, partCount }: { status: SourceStatus; partsDone: number; partCount: number }) {
  const theme = useTheme();
  const stage = stageOf(status);
  const percent = summaryPercent({ status, partCount, partsDone });
  const detail = stage === "summarizing" && partCount > 0 ? `${stageWord(stage)}, part ${Math.min(partsDone + 1, partCount)} of ${partCount}` : stageWord(stage);
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-1.5">
        <Loader size={14} color={theme.mutedForeground} />
        <Text variant="small" className="text-muted-foreground" accessibilityLiveRegion="polite">
          {detail}
        </Text>
      </View>
      {percent !== null ? <ProgressBar value={percent / 100} label={`${detail}, ${percent} percent`} /> : null}
    </View>
  );
}

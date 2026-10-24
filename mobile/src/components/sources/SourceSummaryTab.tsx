import { View } from "react-native";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import type { SourceFlag } from "@/lib/sources/model";
import { FlagCard } from "./FlagCard";

/** The AI summary, then the few details rated most likely to be tested. */
export function SourceSummaryTab({
  summary,
  flags,
  onOpenFlag,
  onSeeAll,
}: {
  summary: string | null;
  flags: SourceFlag[];
  onOpenFlag: (flag: SourceFlag) => void;
  onSeeAll: () => void;
}) {
  const top = flags.filter((flag) => flag.importance >= 3).slice(0, 5);
  return (
    <View className="gap-5">
      {summary?.trim() ? (
        <View className="rounded-xl border border-border bg-card p-4">
          <Markdown source={summary} />
        </View>
      ) : (
        <View className="rounded-xl border border-dashed border-border px-5 py-8">
          <Text variant="muted" className="text-center">
            There is no summary for this file.
          </Text>
        </View>
      )}
      {top.length > 0 ? (
        <View className="gap-3">
          <Text variant="heading">Most likely on a test</Text>
          {top.map((flag) => (
            <FlagCard key={flag.id} flag={flag} onOpen={onOpenFlag} />
          ))}
          <Button label="See all details" variant="outline" onPress={onSeeAll} />
        </View>
      ) : null}
    </View>
  );
}

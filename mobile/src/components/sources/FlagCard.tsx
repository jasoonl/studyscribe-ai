import { useState } from "react";
import { Pressable, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import { formatLocation } from "@/lib/sources/location";
import type { SourceFlag } from "@/lib/sources/model";
import { useTheme } from "@/theme/tokens";

const KIND_LABEL: Record<SourceFlag["kind"], string> = {
  definition: "Definition",
  formula: "Formula",
  date: "Date",
  example: "Example",
  exam_point: "Exam point",
};

const IMPORTANCE: Record<1 | 2 | 3, string> = { 1: "Good to know", 2: "Important", 3: "Very likely" };

/** One detail worth knowing, with the place it came from. Long text expands on tap; the place opens the page. */
export function FlagCard({ flag, onOpen }: { flag: SourceFlag; onOpen: (flag: SourceFlag) => void }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const place = formatLocation(flag.label);
  const importance = IMPORTANCE[Math.min(3, Math.max(1, flag.importance)) as 1 | 2 | 3];
  const long = flag.text.length > 180;
  return (
    <View className="gap-2 rounded-xl border border-border bg-card p-4">
      <View className="flex-row flex-wrap items-center gap-2">
        <Badge label={KIND_LABEL[flag.kind]} tone="primary" />
        <Text variant="caption">{importance}</Text>
      </View>
      <Text variant="body" numberOfLines={expanded ? undefined : 5}>
        {flag.text}
      </Text>
      {long ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Show less" : "Show more"}
          onPress={() => setExpanded((value) => !value)}
          className="min-h-[44px] justify-center self-start"
        >
          <Text variant="label" className="text-primary">
            {expanded ? "Show less" : "Show more"}
          </Text>
        </Pressable>
      ) : null}
      {flag.quote ? (
        <View className="border-l-2 border-border pl-3">
          <Text variant="muted" className="italic">
            {flag.quote}
          </Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${place}`}
        onPress={() => onOpen(flag)}
        className="min-h-[44px] flex-row items-center gap-1 self-start rounded-full border border-border px-3 active:bg-secondary"
      >
        <Text variant="label" className="shrink">
          {place}
        </Text>
        <ChevronRight size={16} color={theme.mutedForeground} />
      </Pressable>
    </View>
  );
}

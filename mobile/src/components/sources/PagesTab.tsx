import { useState } from "react";
import { Pressable, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { formatLocation } from "@/lib/sources/location";
import { useTheme } from "@/theme/tokens";
import { UnitReader } from "./UnitReader";

/** A page chooser (a sheet with every page, slide or section) above the reader. */
export function PagesTab({
  sourceId,
  units,
  current,
  quote,
  focusHeading,
  noun,
  onSelect,
  onReveal,
}: {
  sourceId: number;
  units: { unitIndex: number; label: string }[];
  current: number;
  quote: string | null;
  focusHeading: boolean;
  noun: string;
  onSelect: (unitIndex: number) => void;
  onReveal: (y: number) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const readerY = useState({ current: 0 })[0];
  const position = units.findIndex((item) => item.unitIndex === current);
  if (units.length === 0) {
    return (
      <View className="rounded-xl border border-dashed border-border px-5 py-8">
        <Text variant="muted" className="text-center">
          No text was found to show here.
        </Text>
      </View>
    );
  }
  const currentLabel = formatLocation(units[Math.max(0, position)]?.label ?? "");
  return (
    <View className="gap-4">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose a ${noun}. Showing ${currentLabel}`}
        onPress={() => setOpen(true)}
        className="min-h-[48px] flex-row items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 active:bg-secondary"
      >
        <Text variant="label" className="flex-1" numberOfLines={2}>
          {currentLabel}
        </Text>
        <ChevronDown size={18} color={theme.mutedForeground} />
      </Pressable>
      <View onLayout={(event) => (readerY.current = event.nativeEvent.layout.y)}>
        <UnitReader
          sourceId={sourceId}
          units={units}
          current={current}
          quote={quote}
          focusHeading={focusHeading}
          onSelect={onSelect}
          onReveal={(y) => onReveal(readerY.current + y)}
        />
      </View>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Choose a ${noun}`}>
        <View accessibilityRole="list">
          {units.map((item) => {
            const selected = item.unitIndex === current;
            return (
              <Pressable
                key={item.unitIndex}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={formatLocation(item.label)}
                onPress={() => {
                  setOpen(false);
                  onSelect(item.unitIndex);
                }}
                className={selected ? "min-h-[44px] justify-center rounded-lg bg-secondary px-3" : "min-h-[44px] justify-center rounded-lg px-3 active:bg-muted"}
              >
                <Text variant="body" className={selected ? "font-semibold" : undefined} numberOfLines={2}>
                  {formatLocation(item.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

import { useEffect, useRef } from "react";
import { AccessibilityInfo, findNodeHandle, View, type NativeSyntheticEvent, type TextLayoutEventData } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/misc";
import { Text } from "@/components/ui/Text";
import { findQuote, formatLocation } from "@/lib/sources/location";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";
import { lineIndexAt, revealKey, sourceErrorText } from "./detailModel";

type Lines = { text: string; y: number }[];

/**
 * The extracted text of one page, slide or section with the cited quote highlighted. When the
 * screen was opened from a link, accessibility focus moves to the heading and the highlight is
 * scrolled into view once per source, page and quote. The effect depends only on a string key
 * and booleans, never on the arrays the parent rebuilds on every poll, so it cannot fire again.
 */
export function UnitReader({
  sourceId,
  units,
  current,
  quote,
  focusHeading,
  onSelect,
  onReveal,
}: {
  sourceId: number;
  units: { unitIndex: number; label: string }[];
  current: number;
  quote: string | null;
  focusHeading: boolean;
  onSelect: (unitIndex: number) => void;
  /** Distance from the top of this component to the place that should be visible. */
  onReveal: (y: number) => void;
}) {
  const theme = useTheme();
  const unit = trpc.sources.getUnit.useQuery({ id: sourceId, unitIndex: current }, { retry: false, placeholderData: (previous) => previous });
  const heading = useRef<View>(null);
  const position = units.findIndex((item) => item.unitIndex === current);
  const previous = position > 0 ? units[position - 1] : null;
  const next = position >= 0 && position < units.length - 1 ? units[position + 1] : null;
  const text = unit.data && unit.data.unitIndex === current ? unit.data.text : null;
  const range = text ? findQuote(text, quote) : null;
  const rangeStart = range ? range[0] : -1;

  const key = revealKey(sourceId, current, quote);
  const applied = useRef<string | null>(null);
  const pending = useRef(false);
  const layout = useRef<{ text: string; lines: Lines } | null>(null);
  const offsets = useRef({ article: 0, text: 0 });
  const ready = text !== null;

  const reveal = (lines: Lines) => {
    const index = rangeStart >= 0 && text !== null ? lineIndexAt(lines, rangeStart, text.length) : null;
    const line = index !== null ? lines[index] : null;
    onReveal(offsets.current.article + (line ? offsets.current.text + line.y : 0));
  };
  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  useEffect(() => {
    if (!ready || applied.current === key) return;
    applied.current = key;
    if (focusHeading) {
      const tag = findNodeHandle(heading.current);
      if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
    }
    if (layout.current && layout.current.text === text) revealRef.current(layout.current.lines);
    else pending.current = true;
    // text is intentionally read through `ready`: only the first arrival of a page matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, focusHeading]);

  const onTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    if (text === null) return;
    const lines = event.nativeEvent.lines.map((line) => ({ text: line.text, y: line.y }));
    layout.current = { text, lines };
    if (pending.current) {
      pending.current = false;
      revealRef.current(lines);
    }
  };

  const label = formatLocation(units[position]?.label ?? "");
  const mark = { backgroundColor: `${theme.brandSky}55`, textDecorationLine: "underline" as const };

  return (
    <View className="gap-4">
      <View onLayout={(event) => (offsets.current.article = event.nativeEvent.layout.y)} className="gap-3 rounded-xl border border-border bg-card p-4">
        <View ref={heading} accessible accessibilityRole="header" accessibilityLabel={label}>
          <Text variant="heading">{label}</Text>
        </View>
        {unit.isError ? (
          <View accessibilityRole="alert" className="gap-2">
            <Text variant="small" className="text-destructive">
              {sourceErrorText(unit.error) || "This page could not be loaded."}
            </Text>
            <Button label="Try again" variant="outline" size="sm" onPress={() => void unit.refetch()} />
          </View>
        ) : text === null ? (
          <View accessibilityLabel="Loading" accessible className="gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </View>
        ) : (
          <Text
            variant="body"
            selectable
            onLayout={(event) => (offsets.current.text = event.nativeEvent.layout.y)}
            onTextLayout={onTextLayout}
            accessibilityLabel={range ? `${text}. Highlighted: ${text.slice(range[0], range[1])}` : undefined}
          >
            {range ? (
              <>
                {text.slice(0, range[0])}
                <Text variant="body" style={mark}>
                  {text.slice(range[0], range[1])}
                </Text>
                {text.slice(range[1])}
              </>
            ) : (
              text
            )}
          </Text>
        )}
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button
            label="Previous"
            accessibilityLabel={previous ? `Previous: ${formatLocation(previous.label)}` : "Previous, none"}
            variant="outline"
            disabled={!previous}
            icon={<ChevronLeft size={18} color={theme.foreground} />}
            onPress={() => previous && onSelect(previous.unitIndex)}
          />
        </View>
        <View className="flex-1">
          <Button
            label="Next"
            accessibilityLabel={next ? `Next: ${formatLocation(next.label)}` : "Next, none"}
            variant="outline"
            disabled={!next}
            icon={<ChevronRight size={18} color={theme.foreground} />}
            onPress={() => next && onSelect(next.unitIndex)}
          />
        </View>
      </View>
    </View>
  );
}

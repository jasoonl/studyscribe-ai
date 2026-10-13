import { Pressable, ScrollView, View } from "react-native";
import * as Haptics from "expo-haptics";
import { cn } from "@/lib/cn";
import { Text } from "./Text";

/**
 * Tabs as a segmented control (the web's Tabs list): a muted track with the
 * selected option raised on a card-coloured pill. Scrolls when the options
 * do not fit, e.g. at large text sizes.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Read by screen readers as the group's name. */
  label: string;
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} className={cn("rounded-lg bg-muted p-1", className)}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="flex-grow">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => {
                if (!selected) Haptics.selectionAsync().catch(() => undefined);
                onChange(option.value);
              }}
              className={cn("min-h-[36px] flex-1 items-center justify-center rounded-md px-3", selected && "bg-card shadow-sm")}
            >
              <Text variant="label" numberOfLines={1} className={selected ? "text-foreground" : "text-muted-foreground"}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

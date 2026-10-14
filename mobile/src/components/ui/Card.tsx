import type { ReactNode } from "react";
import { Pressable, View, type ViewProps } from "react-native";
import { cn } from "@/lib/cn";
import { Text } from "./Text";

export function Card({ className, ...props }: ViewProps & { className?: string }) {
  return <View className={cn("rounded-xl border border-border bg-card p-4", className)} {...props} />;
}

/** A card that is one tap target (a recording row, a course). */
export function PressableCard({
  className,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  children,
}: {
  className?: string;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      className={cn("rounded-xl border border-border bg-card p-4 active:bg-muted", className)}
    >
      {children}
    </Pressable>
  );
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <View className="mb-3 flex-row items-start justify-between gap-3">
      <View className="flex-1 gap-0.5">
        <Text variant="subheading">{title}</Text>
        {description ? <Text variant="muted">{description}</Text> : null}
      </View>
      {action}
    </View>
  );
}

/** Section title above a group of cards, like the web's small uppercase-free headings. */
export function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <View className="mb-2 mt-6 flex-row items-center justify-between">
      <Text variant="heading" className="text-[17px]">
        {children}
      </Text>
      {action}
    </View>
  );
}

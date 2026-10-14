import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Check, ChevronRight } from "lucide-react-native";
import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/tokens";
import { Button } from "./Button";
import { Text } from "./Text";

/** Placeholder block while content loads (the web's Skeleton). */
export function Skeleton({ className }: { className?: string }) {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className={cn("rounded-md bg-muted", className)} />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <View accessibilityLabel="Loading" accessible className="gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} className="gap-2 rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View className="items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10">
      {icon ? <View className="mb-1 h-12 w-12 items-center justify-center rounded-full bg-secondary">{icon}</View> : null}
      <Text variant="subheading" className="text-center">
        {title}
      </Text>
      {body ? (
        <Text variant="muted" className="text-center">
          {body}
        </Text>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} variant="outline" size="sm" className="mt-2" /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8">
      <Text variant="subheading" className="text-center">
        Couldn't load this
      </Text>
      <Text variant="muted" className="text-center">
        {message}
      </Text>
      {onRetry ? <Button label="Try again" onPress={onRetry} variant="outline" size="sm" className="mt-2" /> : null}
    </View>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  const theme = useTheme();
  return (
    <View className="items-center justify-center py-10" accessible accessibilityLabel={label}>
      <ActivityIndicator color={theme.primary} />
    </View>
  );
}

export function Checkbox({ checked, onChange, label, children }: { checked: boolean; onChange: (value: boolean) => void; label: string; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      className="min-h-[44px] flex-row items-start gap-3 py-1"
    >
      <View className={cn("mt-0.5 h-[22px] w-[22px] items-center justify-center rounded-md border", checked ? "border-primary bg-primary" : "border-input bg-card")}>
        {checked ? <Check size={15} strokeWidth={3} color={theme.primaryForeground} /> : null}
      </View>
      <View className="flex-1">{children ?? <Text variant="small">{label}</Text>}</View>
    </Pressable>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <View className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </View>
  );
}

/** A tappable settings-style row. */
export function ListRow({
  title,
  subtitle,
  icon,
  trailing,
  onPress,
  destructive,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const content = (
    <>
      {icon ? <View className="h-8 w-8 items-center justify-center rounded-lg bg-secondary">{icon}</View> : null}
      <View className="flex-1 gap-0.5">
        <Text variant="body" className={destructive ? "text-destructive" : undefined}>
          {title}
        </Text>
        {subtitle ? <Text variant="muted">{subtitle}</Text> : null}
      </View>
      {trailing ?? (onPress ? <ChevronRight size={18} color={theme.mutedForeground} /> : null)}
    </>
  );
  if (!onPress) return <View className="min-h-[52px] flex-row items-center gap-3 px-4 py-3">{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      className="min-h-[52px] flex-row items-center gap-3 px-4 py-3 active:bg-muted"
    >
      {content}
    </Pressable>
  );
}

/** A rounded group of ListRows with hairline separators (iOS grouped list, Material list card). */
export function ListGroup({ children }: { children: ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View className="overflow-hidden rounded-xl border border-border bg-card">
      {items.map((child, index) => (
        <View key={index} className={index > 0 ? "border-t border-border" : undefined}>
          {child}
        </View>
      ))}
    </View>
  );
}

import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/tokens";
import { Text } from "./Text";

/**
 * A screen's frame: background, safe area, content width capped for tablets,
 * optional pull-to-refresh. Screens inside a native stack header pass
 * `edges={["bottom"]}` because the header already covers the top inset.
 */
export function Screen({
  children,
  scroll = true,
  edges = ["top"],
  refreshing,
  onRefresh,
  className,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  refreshing?: boolean;
  onRefresh?: () => void;
  className?: string;
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const body = <View className={cn("w-full max-w-[720px] self-center gap-4 px-4 pb-10 pt-3", className)}>{children}</View>;
  return (
    <SafeAreaView edges={edges} className="flex-1 bg-background">
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.primary} /> : undefined}
        >
          {body}
        </ScrollView>
      ) : (
        <View className="flex-1">{body}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}

/** Large title at the top of a tab screen, with an optional trailing control. */
export function ScreenTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View className="flex-row items-end justify-between gap-3 pt-2">
      <View className="flex-1 gap-1">
        <Text variant="display">{title}</Text>
        {subtitle ? <Text variant="muted">{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

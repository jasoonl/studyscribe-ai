import { forwardRef, type ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type PressableProps } from "react-native";
import * as Haptics from "expo-haptics";
import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/tokens";
import { Text } from "./Text";

/** Same variants as the web's shadcn Button. */
const containers = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  outline: "border border-border bg-card",
  ghost: "bg-transparent",
  destructive: "bg-destructive",
  /** A destructive action that is not the point of the screen (e.g. Empty trash under the list). */
  destructiveOutline: "border border-destructive/40 bg-card",
  destructiveGhost: "bg-transparent",
} as const;

const labels = {
  primary: "text-primary-foreground",
  secondary: "text-secondary-foreground",
  outline: "text-foreground",
  ghost: "text-primary",
  destructive: "text-destructive-foreground",
  destructiveOutline: "text-destructive",
  destructiveGhost: "text-destructive",
} as const;

const sizes = {
  sm: "min-h-[36px] px-3 rounded-md",
  md: "min-h-[48px] px-4 rounded-lg",
  lg: "min-h-[54px] px-5 rounded-lg",
} as const;

export type ButtonProps = Omit<PressableProps, "children"> & {
  label: string;
  variant?: keyof typeof containers;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: ReactNode;
  className?: string;
  /** A light tap on press, for primary actions. */
  haptic?: boolean;
};

export const Button = forwardRef<View, ButtonProps>(function Button(
  { label, variant = "primary", size = "md", loading, icon, className, disabled, haptic, onPress, accessibilityLabel, ...props },
  ref,
) {
  const theme = useTheme();
  const inactive = disabled || loading;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={(event) => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress?.(event);
      }}
      android_ripple={{ color: "rgba(0,0,0,0.12)", foreground: true }}
      className={cn("flex-row items-center justify-center gap-2 overflow-hidden", containers[variant], sizes[size], inactive && "opacity-50", className)}
      {...props}
    >
      {({ pressed }) => (
        <>
          <PressDim pressed={pressed} />
          {loading ? (
            <ActivityIndicator size="small" color={variant === "primary" || variant === "destructive" ? theme.primaryForeground : theme.primary} />
          ) : (
            icon
          )}
          <Text variant={size === "sm" ? "label" : "subheading"} className={cn(labels[variant], size === "sm" && "font-medium")}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
});

/**
 * Press feedback: a slight darkening, like the web Button's brightness change,
 * rather than fading the whole control. The parent needs overflow-hidden.
 */
export function PressDim({ pressed }: { pressed: boolean }) {
  if (!pressed) return null;
  return <View pointerEvents="none" className="absolute inset-0 bg-black/10" />;
}

/** A round icon-only button with a required accessibility label. */
export function IconButton({ icon, label, onPress, className, disabled }: { icon: ReactNode; label: string; onPress?: () => void; className?: string; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      className={cn("h-10 w-10 items-center justify-center rounded-full active:bg-muted", disabled && "opacity-40", className)}
    >
      {icon}
    </Pressable>
  );
}

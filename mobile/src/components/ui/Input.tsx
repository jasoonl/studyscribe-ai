import { forwardRef, useState } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import { Eye, EyeOff } from "lucide-react-native";
import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/tokens";
import { Text } from "./Text";

export type InputProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string | null;
  className?: string;
  /** Adds a show/hide control and turns off autocorrect. */
  secure?: boolean;
};

export const Input = forwardRef<TextInput, InputProps>(function Input({ label, hint, error, className, secure, multiline, ...props }, ref) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  return (
    <View className={cn("gap-1.5", className)}>
      {label ? <Text variant="label">{label}</Text> : null}
      <View
        className={cn(
          "flex-row items-center rounded-lg border bg-card",
          focused ? "border-ring" : error ? "border-destructive" : "border-input",
          multiline ? "min-h-[104px] items-start" : "min-h-[48px]",
        )}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label ?? props.placeholder}
          accessibilityHint={error ?? hint}
          placeholderTextColor={theme.mutedForeground}
          secureTextEntry={secure ? hidden : undefined}
          autoCorrect={secure ? false : props.autoCorrect}
          autoCapitalize={secure ? "none" : props.autoCapitalize}
          multiline={multiline}
          maxFontSizeMultiplier={1.6}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
          className={cn("flex-1 px-3.5 py-3 font-sans text-[16px] text-foreground", multiline && "min-h-[104px]")}
          style={multiline ? { textAlignVertical: "top" } : undefined}
          {...props}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
            onPress={() => setHidden((value) => !value)}
            hitSlop={8}
            className="px-3"
          >
            {hidden ? <Eye size={20} color={theme.mutedForeground} /> : <EyeOff size={20} color={theme.mutedForeground} />}
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="small" className="text-destructive" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
});

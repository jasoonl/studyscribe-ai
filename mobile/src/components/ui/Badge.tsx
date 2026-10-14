import { View } from "react-native";
import { cn } from "@/lib/cn";
import { Text } from "./Text";

const tones = {
  neutral: { box: "bg-muted", text: "text-muted-foreground" },
  primary: { box: "bg-secondary", text: "text-secondary-foreground" },
  success: { box: "bg-course-green/15", text: "text-course-green" },
  warning: { box: "bg-course-amber/15", text: "text-course-amber" },
  danger: { box: "bg-destructive/10", text: "text-destructive" },
} as const;

export function Badge({ label, tone = "neutral", className }: { label: string; tone?: keyof typeof tones; className?: string }) {
  return (
    <View className={cn("self-start rounded-full px-2.5 py-0.5", tones[tone].box, className)}>
      <Text variant="caption" className={cn("font-medium", tones[tone].text)}>
        {label}
      </Text>
    </View>
  );
}

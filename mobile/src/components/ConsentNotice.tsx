import { View } from "react-native";
import { ShieldCheck } from "lucide-react-native";
import { Text } from "@/components/ui/Text";
import { openWebPage } from "@/lib/browser";
import { useTheme } from "@/theme/tokens";

/** Same wording as the web's RecordingConsentNotice: shown wherever someone starts adding audio. */
export function ConsentNotice() {
  const theme = useTheme();
  return (
    <View accessibilityRole="summary" className="flex-row items-start gap-3 rounded-xl border border-primary/20 bg-brand-mist p-4">
      <ShieldCheck size={20} color={theme.primary} />
      <Text variant="small" className="flex-1 text-foreground/80">
        <Text variant="small" className="font-semibold">
          Only record with permission.
        </Text>{" "}
        Many places require everyone's consent to record a conversation. Make sure you have permission from the people you record, and only add audio, video or links you have the right to use. See our{" "}
        <Text variant="small" className="font-medium text-primary underline" accessibilityRole="link" onPress={() => openWebPage("/terms")}>
          Terms
        </Text>
        .
      </Text>
    </View>
  );
}

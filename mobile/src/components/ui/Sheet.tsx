import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useTheme } from "@/theme/tokens";
import { IconButton } from "./Button";
import { Text } from "./Text";

/** A bottom sheet (the web's Dialog/Sheet): slides up, or appears without motion when Reduce Motion is on. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const theme = useTheme();
  return (
    <Modal visible={open} transparent animationType={reduced ? "none" : "slide"} onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="absolute inset-0 bg-black/40" />
        <View
          accessibilityViewIsModal
          className="max-h-[88%] rounded-t-3xl border border-border bg-background"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="items-center pt-2.5">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>
          <View className="flex-row items-start gap-3 px-5 pb-2 pt-3">
            <View className="flex-1 gap-1">
              <Text variant="heading">{title}</Text>
              {description ? <Text variant="muted">{description}</Text> : null}
            </View>
            <IconButton label="Close" onPress={onClose} icon={<X size={20} color={theme.mutedForeground} />} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="px-5 pb-4 pt-2 gap-4">
            {children}
          </ScrollView>
          {footer ? <View className="gap-2 border-t border-border px-5 pt-3">{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

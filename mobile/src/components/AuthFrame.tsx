import type { ReactNode } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/Text";

/** The frame shared by sign-in, sign-up and password screens: the mark, a title, the form. */
export function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="flex-grow justify-center px-6 py-8">
          <View className="w-full max-w-[440px] self-center gap-6">
            <View className="items-center gap-3">
              <Image source={require("@/assets/images/logo.png")} accessibilityIgnoresInvertColors style={{ width: 64, height: 64 }} resizeMode="contain" accessibilityLabel="StudyScribe" />
              <View className="items-center gap-1.5">
                <Text variant="title" className="text-center">
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant="muted" className="text-center">
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            </View>
            {children}
            {footer ? <View className="items-center gap-2 pt-2">{footer}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** "or" between the email form and the social buttons. */
export function OrDivider() {
  return (
    <View className="flex-row items-center gap-3" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View className="h-px flex-1 bg-border" />
      <Text variant="caption">or</Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}

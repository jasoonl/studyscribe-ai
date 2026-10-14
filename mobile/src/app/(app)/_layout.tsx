import { Stack } from "expo-router";
import { useTheme } from "@/theme/tokens";

/** Signed-in navigation: the tab bar, with detail screens pushed on top using native headers. */
export default function AppLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.primary,
        headerTitleStyle: { fontFamily: "Geist_600SemiBold", color: theme.foreground },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.background },
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="recording/[id]/index" options={{ title: "" }} />
      <Stack.Screen name="recording/[id]/flashcards" options={{ title: "Flashcards" }} />
      <Stack.Screen name="recording/[id]/quiz" options={{ title: "Quiz" }} />
      <Stack.Screen name="recording/[id]/guide" options={{ title: "Study guide" }} />
      <Stack.Screen name="recording/[id]/tutor" options={{ title: "AI tutor" }} />
      <Stack.Screen name="recording/[id]/drafts" options={{ title: "Email drafts" }} />
      <Stack.Screen name="courses/[id]" options={{ title: "Course" }} />
      <Stack.Screen name="exam-packs/index" options={{ title: "Exam packs" }} />
      <Stack.Screen name="exam-packs/[id]" options={{ title: "Exam pack" }} />
      <Stack.Screen name="shared-with-me/index" options={{ title: "Shared with me" }} />
      <Stack.Screen name="trash" options={{ title: "Trash" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="vocabulary" options={{ title: "Custom vocabulary" }} />
      <Stack.Screen name="plan" options={{ title: "Plan and usage" }} />
      <Stack.Screen name="delete-account" options={{ title: "Delete account", presentation: "modal" }} />
    </Stack>
  );
}

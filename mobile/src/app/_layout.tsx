import "../global.css";
import "@/lib/interop";
import { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { Stack, ThemeProvider, DarkTheme, DefaultTheme } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from "@expo-google-fonts/geist";
import { needsUpdate } from "@shared/mobile";
import { ToastProvider } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { APP_VERSION } from "@/lib/config";
import { RecorderProvider } from "@/lib/recorder/RecorderProvider";
import { UploadsProvider } from "@/lib/sources/UploadsProvider";
import { SessionProvider, authClient, useSession } from "@/lib/SessionProvider";
import { usePushRegistration } from "@/lib/push";
import { useTheme } from "@/theme/tokens";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold });
  const ready = fontsLoaded || !!fontError;
  return (
    <SafeAreaProvider>
      <SessionProvider>{ready ? <AppShell /> : null}</SessionProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const theme = useTheme();
  const { state } = useSession();
  const signedIn = state.status === "signedIn";
  const [update, setUpdate] = useState<{ ios: string | null; android: string | null } | null>(null);

  useEffect(() => {
    if (state.status !== "loading") SplashScreen.hideAsync().catch(() => undefined);
  }, [state.status]);

  // The server can require a newer app (shared/mobile.ts) when an API changes.
  useEffect(() => {
    authClient
      .config()
      .then((config) => {
        if (needsUpdate(APP_VERSION, config.minVersion)) setUpdate(config.storeUrls);
      })
      .catch(() => undefined);
  }, []);

  usePushRegistration(signedIn);

  const navigationTheme = {
    ...(theme.scheme === "dark" ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme.scheme === "dark" ? DarkTheme : DefaultTheme).colors,
      primary: theme.primary,
      background: theme.background,
      card: theme.background,
      text: theme.foreground,
      border: theme.border,
      notification: theme.primary,
    },
  };

  if (state.status === "loading") return <View className="flex-1 bg-background" />;
  if (update) return <UpdateRequired urls={update} />;

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
      <ToastProvider>
        <RecorderProvider>
          <UploadsProvider>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
              <Stack.Protected guard={signedIn}>
                <Stack.Screen name="(app)" />
              </Stack.Protected>
              <Stack.Protected guard={!signedIn}>
                <Stack.Screen name="(auth)" />
              </Stack.Protected>
            </Stack>
          </UploadsProvider>
        </RecorderProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

function UpdateRequired({ urls }: { urls: { ios: string | null; android: string | null } }) {
  const url = Platform.OS === "ios" ? urls.ios : urls.android;
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
      <Text variant="title" className="text-center">
        Update StudyScribe
      </Text>
      <Text variant="muted" className="text-center">
        This version of the app is no longer supported. Update to keep recording and studying. Your recordings are safe.
      </Text>
      {url ? <Button label="Open the store" onPress={() => Linking.openURL(url)} /> : null}
    </View>
  );
}

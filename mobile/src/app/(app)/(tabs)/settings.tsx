import { useEffect, useState } from "react";
import { Alert, Linking, Platform, View } from "react-native";
import { router } from "expo-router";
import { Bell, BookA, CreditCard, Download, LogOut, Trash2, UserRound } from "lucide-react-native";
import { CONTACT_EMAIL } from "@shared/legal";
import { SectionTitle } from "@/components/ui/Card";
import { ListGroup, ListRow } from "@/components/ui/misc";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { openWebPage } from "@/lib/browser";
import { APP_VERSION } from "@/lib/config";
import { shareExport } from "@/lib/exportData";
import { getPushToken, pushPermission, useAskForPush, type PushPermission } from "@/lib/push";
import { useRecorder } from "@/lib/recorder/RecorderProvider";
import { isLive } from "@/lib/recorder/machine";
import { useSession, useUser } from "@/lib/SessionProvider";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

export default function SettingsScreen() {
  const theme = useTheme();
  const toast = useToast();
  const user = useUser();
  const { controller } = useSession();
  const recorder = useRecorder();
  const askForPush = useAskForPush();
  const [permission, setPermission] = useState<PushPermission>("unsupported");
  const exportData = trpc.account.exportData.useMutation({
    onSuccess: (data) => shareExport(data).catch((error) => toast.show(errorMessage(error), "error")),
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  useEffect(() => {
    pushPermission().then(setPermission).catch(() => undefined);
  }, []);

  const icon = (Icon: typeof Bell, color = theme.primary) => <Icon size={18} color={color} />;

  function signOut() {
    const warn = isLive(recorder.state) || recorder.state.phase === "stopped" || recorder.state.phase === "failed";
    Alert.alert(
      "Sign out?",
      warn ? "You have a recording on this phone that hasn't been uploaded. It stays on the phone, but upload it before someone else signs in." : undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: () => controller.signOut(getPushToken()) },
      ],
    );
  }

  async function notifications() {
    if (permission === "granted") {
      Linking.openSettings();
      return;
    }
    if (permission === "denied") {
      Alert.alert("Notifications are off", "Turn them on for StudyScribe in Settings to hear when a transcript is ready.", [
        { text: "Not now", style: "cancel" },
        { text: "Open Settings", onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    const granted = await askForPush();
    setPermission(granted ? "granted" : await pushPermission());
  }

  const permissionLabel = permission === "granted" ? "On" : permission === "denied" ? "Off" : permission === "unsupported" ? "Not available on this device" : "Not set up";

  return (
    <Screen>
      <ScreenTitle title="Settings" />
      <ListGroup>
        <ListRow title={user.name || "Your account"} subtitle={user.email} icon={icon(UserRound)} />
        <ListRow title="Plan and usage" icon={icon(CreditCard)} onPress={() => router.push("/plan")} />
      </ListGroup>

      <SectionTitle>Transcription</SectionTitle>
      <ListGroup>
        <ListRow title="Custom vocabulary" subtitle="Names and terms to listen for in every recording" icon={icon(BookA)} onPress={() => router.push("/vocabulary")} />
        <ListRow title="Notifications" subtitle={permissionLabel} icon={icon(Bell)} onPress={permission === "unsupported" ? undefined : notifications} accessibilityHint="Get a notification when a transcript is ready" />
      </ListGroup>

      <SectionTitle>Your data</SectionTitle>
      <ListGroup>
        <ListRow title={exportData.isPending ? "Preparing your export…" : "Export my data"} subtitle="Everything we hold about you, as a JSON file" icon={icon(Download)} onPress={exportData.isPending ? undefined : () => exportData.mutate()} />
        <ListRow title="Delete account" subtitle="Permanently removes your recordings and data" icon={icon(Trash2, theme.destructive)} destructive onPress={() => router.push("/delete-account")} />
      </ListGroup>

      <SectionTitle>Help and legal</SectionTitle>
      <ListGroup>
        <ListRow title="Help" onPress={() => openWebPage("/help")} />
        <ListRow title="Terms of Service" onPress={() => openWebPage("/terms")} />
        <ListRow title="Privacy Policy" onPress={() => openWebPage("/privacy")} />
        <ListRow title="Cookie Policy" onPress={() => openWebPage("/cookies")} />
        <ListRow title="Refund Policy" onPress={() => openWebPage("/refunds")} />
        <ListRow title="Credits and licences" onPress={() => openWebPage("/credits")} />
        <ListRow title="Contact support" subtitle={CONTACT_EMAIL} onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)} />
      </ListGroup>

      <View className="mt-6">
        <ListGroup>
          <ListRow title="Sign out" icon={icon(LogOut, theme.destructive)} destructive onPress={signOut} />
        </ListGroup>
      </View>
      <Text variant="caption" className="mt-2 text-center">
        StudyScribe {APP_VERSION} ({Platform.OS})
      </Text>
    </Screen>
  );
}

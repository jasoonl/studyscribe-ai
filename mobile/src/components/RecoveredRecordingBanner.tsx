import { View } from "react-native";
import { router } from "expo-router";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { formatClock, isLive } from "@/lib/recorder/machine";
import { useRecorder } from "@/lib/recorder/RecorderProvider";

/** On other screens: a recording in progress, or one stopped but not yet sent (including one recovered after a crash). */
export function RecoveredRecordingBanner() {
  const { state, elapsed } = useRecorder();
  if (state.phase === "idle" || state.phase === "submitted") return null;
  const live = isLive(state);
  const title = live ? (state.phase === "paused" ? "Recording paused" : "Recording in progress") : state.phase === "uploading" ? "Uploading your recording" : "A recording is waiting to be saved";
  const body = live
    ? `${formatClock(elapsed())} recorded. It keeps going while you use the app or lock the phone.`
    : state.phase === "failed"
      ? `The upload stopped: ${state.error} Your audio is still on this phone.`
      : `${formatClock(elapsed())} of audio is on this phone. Save it to transcribe it, or discard it.`;
  return (
    <View accessibilityRole="alert" className="gap-3 rounded-xl border border-primary/25 bg-secondary p-4">
      <View className="gap-1">
        <Text variant="subheading" className="text-secondary-foreground">
          {title}
        </Text>
        <Text variant="small" className="text-secondary-foreground/80">
          {body}
        </Text>
      </View>
      <Button label={live ? "Open recorder" : "Review recording"} size="sm" variant="outline" className="self-start" onPress={() => router.push("/record")} />
    </View>
  );
}

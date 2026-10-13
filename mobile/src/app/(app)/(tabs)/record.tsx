import { useState } from "react";
import { Alert, Linking, Platform, Pressable, View } from "react-native";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Bookmark, FileAudio, Film, Link2, Mic, Pause, Play, Square } from "lucide-react-native";
import { MAX_LINK_IMPORT_LABEL, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@shared/const";
import { ConsentNotice } from "@/components/ConsentNotice";
import { RecordingOptions, emptyOptions, parseTerms, type RecordingOptionsValue } from "@/components/RecordingOptions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ProgressBar } from "@/components/ui/misc";
import { Screen, ScreenTitle } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { API_URL } from "@/lib/config";
import { fileSource, nativeUploadIo } from "@/lib/fileSource";
import { defaultRecordingTitle, formatRecordingDuration } from "@/lib/format";
import { useAskForPush } from "@/lib/push";
import { formatClock, isLive } from "@/lib/recorder/machine";
import { MicrophonePermissionError, useRecorder } from "@/lib/recorder/RecorderProvider";
import { useSession } from "@/lib/SessionProvider";
import { errorMessage, trpc } from "@/lib/trpc";
import { uploadAudio } from "@/lib/upload";
import { useNow } from "@/lib/useNow";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useTheme } from "@/theme/tokens";

type Mode = "record" | "upload" | "link";

export default function RecordScreen() {
  const { state } = useRecorder();
  const [mode, setMode] = useState<Mode>("record");
  const busyRecording = state.phase !== "idle" && state.phase !== "submitted";
  return (
    <Screen>
      <ScreenTitle title="Add a recording" subtitle="Record, upload a file or import a link. We transcribe it with speaker labels." />
      {!busyRecording ? (
        <Segmented
          label="How to add audio"
          value={mode}
          onChange={setMode}
          options={[
            { value: "record", label: "Record" },
            { value: "upload", label: "Upload" },
            { value: "link", label: "Link" },
          ]}
        />
      ) : null}
      {mode === "record" || busyRecording ? <RecordPane /> : mode === "upload" ? <UploadPane /> : <LinkPane />}
    </Screen>
  );
}

function usePushAfterFirstRecording() {
  const ask = useAskForPush();
  return () => {
    if (Platform.OS === "web") return;
    ask().catch(() => undefined);
  };
}

/* ------------------------------------------------------------------ record */

function RecordPane() {
  const recorder = useRecorder();
  const { state } = recorder;
  const theme = useTheme();
  const toast = useToast();
  const reduced = useReducedMotion();
  const now = useNow(isLive(state));
  const [options, setOptions] = useState<RecordingOptionsValue>(() => emptyOptions());
  const askForPush = usePushAfterFirstRecording();

  async function start() {
    try {
      await recorder.start();
    } catch (error) {
      if (error instanceof MicrophonePermissionError) {
        Alert.alert("Microphone access is off", error.message, [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
      } else {
        toast.show(error instanceof Error ? error.message : "Could not start recording.", "error");
      }
    }
  }

  async function save() {
    const id = await recorder.submit({
      title: options.title.trim() || defaultRecordingTitle(),
      audience: "student",
      language: options.language === "auto" ? undefined : options.language,
      keyterms: parseTerms(options.vocabulary),
      courseId: options.courseId,
    });
    if (id) {
      toast.show("Uploaded. We'll let you know when the transcript is ready.", "success");
      askForPush();
      setOptions(emptyOptions());
      recorder.discard();
      router.push(`/recording/${id}`);
    }
  }

  function confirmDiscard() {
    Alert.alert("Discard this recording?", "The audio will be deleted from this phone. This can't be undone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => recorder.discard() },
    ]);
  }

  if (state.phase === "idle" || state.phase === "submitted") {
    return (
      <View className="gap-5">
        <ConsentNotice />
        <View className="items-center gap-3 py-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start recording"
            accessibilityHint="Records until you press stop, even with the screen locked"
            onPress={start}
            className="h-24 w-24 items-center justify-center rounded-full bg-primary active:opacity-85"
          >
            <Mic size={36} color={theme.primaryForeground} />
          </Pressable>
          <Text variant="muted" className="max-w-[300px] text-center">
            Keeps recording with the screen locked or while you use other apps, until you press stop.
          </Text>
        </View>
        <RecordingOptions value={options} onChange={setOptions} />
      </View>
    );
  }

  if (isLive(state)) {
    const seconds = recorder.elapsed(now);
    const paused = state.phase === "paused";
    return (
      <View className="gap-5">
        <Card className="items-center gap-4 py-8">
          <View className="flex-row items-center gap-2">
            <View className={cn("h-2.5 w-2.5 rounded-full", paused ? "bg-course-amber" : "bg-destructive")} />
            <Text variant="label" className="text-muted-foreground">
              {paused ? (state.reason === "interrupted" ? "Paused by an interruption" : "Paused") : "Recording"}
            </Text>
          </View>
          <Text
            variant="display"
            className="text-[52px] leading-[60px]"
            style={{ fontVariant: ["tabular-nums"] }}
            accessibilityLabel={`${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds recorded`}
          >
            {formatClock(seconds)}
          </Text>
          <LevelMeter level={paused ? 0 : recorder.level} reduced={reduced} />
          {state.bookmarks.length > 0 ? (
            <Text variant="muted">
              {state.bookmarks.length} {state.bookmarks.length === 1 ? "moment" : "moments"} marked
            </Text>
          ) : null}
        </Card>
        <View className="flex-row gap-3">
          <Button
            className="flex-1"
            variant="outline"
            label={paused ? "Resume" : "Pause"}
            icon={paused ? <Play size={18} color={theme.foreground} /> : <Pause size={18} color={theme.foreground} />}
            onPress={() => (paused ? recorder.resume() : recorder.pause())}
          />
          <Button className="flex-1" variant="outline" label="Mark moment" icon={<Bookmark size={18} color={theme.foreground} />} onPress={recorder.mark} />
        </View>
        <Button label="Stop" variant="destructive" size="lg" icon={<Square size={18} color={theme.primaryForeground} fill={theme.primaryForeground} />} onPress={() => recorder.stop().catch((error) => toast.show(errorMessage(error), "error"))} haptic />
        <Text variant="caption" className="text-center">
          {Platform.OS === "android" ? "A notification stays up while recording; that is how Android keeps the microphone on." : "You can lock the phone. Recording continues until you press stop."}
        </Text>
      </View>
    );
  }

  // stopped, uploading or failed
  const uploading = state.phase === "uploading";
  return (
    <View className="gap-5">
      <Card className="gap-1">
        <Text variant="subheading">{formatRecordingDuration(recorder.elapsed())} recorded</Text>
        <Text variant="muted">
          {state.bookmarks.length ? `${state.bookmarks.length} marked ${state.bookmarks.length === 1 ? "moment" : "moments"}. ` : ""}
          The audio is saved on this phone until it's uploaded.
        </Text>
      </Card>
      {state.phase === "failed" ? (
        <Text variant="small" className="text-destructive" accessibilityLiveRegion="polite">
          {state.error} Check your connection and try again.
        </Text>
      ) : null}
      {uploading ? (
        <View className="gap-2">
          <Text variant="label">Uploading</Text>
          <ProgressBar value={state.progress} label="Upload progress" />
        </View>
      ) : (
        <RecordingOptions value={options} onChange={setOptions} />
      )}
      <Button label={state.phase === "failed" ? "Try again" : "Save and transcribe"} loading={uploading} onPress={save} haptic />
      {!uploading ? <Button label="Discard" variant="ghost" onPress={confirmDiscard} /> : null}
    </View>
  );
}

function LevelMeter({ level, reduced }: { level: number; reduced: boolean }) {
  const bars = 24;
  const lit = Math.round(level * bars);
  return (
    <View className="h-8 flex-row items-end gap-[3px]" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: bars }, (_, index) => {
        const centre = 1 - Math.abs(index - bars / 2) / (bars / 2);
        const height = reduced ? 8 : 6 + Math.round(26 * centre * level);
        return <View key={index} className={cn("w-[4px] rounded-full", index < lit ? "bg-primary" : "bg-border")} style={{ height }} />;
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ upload */

type Picked = { uri: string; name: string; mimeType: string | null; size: number | null; durationSec?: number };

function UploadPane() {
  const theme = useTheme();
  const toast = useToast();
  const { controller } = useSession();
  const utils = trpc.useUtils();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [options, setOptions] = useState<RecordingOptionsValue>(() => emptyOptions());
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const askForPush = usePushAfterFirstRecording();

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: ["audio/*", "video/*"], copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    choose({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? null, size: asset.size ?? null });
  }

  async function pickVideo() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted && Platform.OS !== "web") {
      toast.show("Allow photo library access in Settings to pick a video.", "error");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], allowsMultipleSelection: false, quality: 1 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    choose({
      uri: asset.uri,
      name: asset.fileName ?? `video.${asset.mimeType === "video/quicktime" ? "mov" : "mp4"}`,
      mimeType: asset.mimeType ?? null,
      size: asset.fileSize ?? null,
      durationSec: asset.duration ? asset.duration / 1000 : undefined,
    });
  }

  function choose(file: Picked) {
    setError(null);
    if (file.size && file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is larger than ${MAX_UPLOAD_LABEL}. Trim it or upload a shorter part.`);
      return;
    }
    setPicked(file);
    setOptions((current) => ({ ...current, title: current.title || file.name.replace(/\.[^.]+$/, "") }));
  }

  async function upload() {
    if (!picked) return;
    setError(null);
    setProgress(0);
    try {
      const source = fileSource(picked.uri, picked.name, picked.mimeType, picked.size);
      if (!source.size && Platform.OS === "web") (source as { size: number }).size = (await (await fetch(picked.uri)).blob()).size;
      const uploaded = await uploadAudio(source, nativeUploadIo(API_URL, controller.getToken(), source), (value) => setProgress(value * 0.9));
      const terms = parseTerms(options.vocabulary);
      const recording = await utils.client.recordings.create.mutate({
        title: options.title.trim() || picked.name,
        audience: "student",
        duration: picked.durationSec ? Math.round(picked.durationSec) : undefined,
        language: options.language === "auto" ? undefined : (options.language as never),
        keyterms: terms.length ? terms : undefined,
        ...(uploaded.kind === "stored" ? { audioUpload: { key: uploaded.key, mimeType: uploaded.mimeType } } : { audioBase64: uploaded.base64 }),
      });
      if (options.courseId) await utils.client.recordings.setCourse.mutate({ recordingId: recording.id, courseId: options.courseId }).catch(() => undefined);
      setProgress(1);
      utils.recordings.list.invalidate().catch(() => undefined);
      toast.show("Uploaded. Transcribing now.", "success");
      askForPush();
      setPicked(null);
      setOptions(emptyOptions());
      router.push(`/recording/${recording.id}`);
    } catch (caught) {
      setError(errorMessage(caught, "The upload failed. Check your connection and try again."));
    } finally {
      setProgress(null);
    }
  }

  return (
    <View className="gap-5">
      <ConsentNotice />
      {picked ? (
        <Card className="flex-row items-center gap-3">
          <FileAudio size={22} color={theme.primary} />
          <View className="flex-1">
            <Text variant="subheading" numberOfLines={1}>
              {picked.name}
            </Text>
            <Text variant="muted">{picked.size ? `${(picked.size / (1024 * 1024)).toFixed(1)} MB` : "Size unknown"}</Text>
          </View>
          {progress === null ? <Button label="Change" size="sm" variant="ghost" onPress={() => setPicked(null)} /> : null}
        </Card>
      ) : (
        <View className="gap-3">
          <Button label="Choose an audio or video file" variant="outline" icon={<FileAudio size={18} color={theme.foreground} />} onPress={pickFile} />
          {Platform.OS !== "web" ? <Button label="Choose a video from Photos" variant="outline" icon={<Film size={18} color={theme.foreground} />} onPress={pickVideo} /> : null}
          <Text variant="caption" className="text-center">
            MP3, M4A, WAV, MP4, MOV and more, up to {MAX_UPLOAD_LABEL}. Videos are transcribed from their audio.
          </Text>
        </View>
      )}
      {picked ? <RecordingOptions value={options} onChange={setOptions} /> : null}
      {progress !== null ? <ProgressBar value={progress} label="Upload progress" /> : null}
      {error ? (
        <Text variant="small" className="text-destructive" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {picked ? <Button label="Upload and transcribe" onPress={upload} loading={progress !== null} haptic /> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ link */

function LinkPane() {
  const theme = useTheme();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [url, setUrl] = useState("");
  const [options, setOptions] = useState<RecordingOptionsValue>(() => emptyOptions());
  const importLink = trpc.recordings.createFromUrl.useMutation({
    onSuccess: async (recording) => {
      if (options.courseId) await utils.client.recordings.setCourse.mutate({ recordingId: recording.id, courseId: options.courseId }).catch(() => undefined);
      utils.recordings.list.invalidate().catch(() => undefined);
      toast.show("Imported. Transcribing now.", "success");
      setUrl("");
      setOptions(emptyOptions());
      router.push(`/recording/${recording.id}`);
    },
  });

  return (
    <View className="gap-5">
      <ConsentNotice />
      <Input
        label="Link to audio or video"
        value={url}
        onChangeText={setUrl}
        placeholder="https://"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hint={`A direct media link, a page that publishes one, or a YouTube video. Up to ${MAX_LINK_IMPORT_LABEL}.`}
      />
      <RecordingOptions value={options} onChange={setOptions} />
      {importLink.error ? (
        <Text variant="small" className="text-destructive" accessibilityLiveRegion="polite">
          {errorMessage(importLink.error)}
        </Text>
      ) : null}
      <Button
        label="Import and transcribe"
        icon={<Link2 size={18} color={theme.primaryForeground} />}
        loading={importLink.isPending}
        disabled={!/^https?:\/\/\S+$/i.test(url.trim())}
        onPress={() => {
          const terms = parseTerms(options.vocabulary);
          importLink.mutate({
            url: url.trim(),
            title: options.title.trim() || undefined,
            audience: "student",
            language: options.language === "auto" ? undefined : (options.language as never),
            keyterms: terms.length ? terms : undefined,
          });
        }}
      />
      {importLink.isPending ? (
        <Text variant="caption" className="text-center">
          Fetching the audio. Long videos can take a minute.
        </Text>
      ) : null}
    </View>
  );
}

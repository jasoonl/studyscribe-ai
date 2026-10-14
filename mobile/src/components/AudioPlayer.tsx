import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioPlayer as Player } from "expo-audio";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react-native";
import { Text } from "@/components/ui/Text";
import { apiUrl } from "@/lib/config";
import { formatTimestamp } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

/**
 * The recording's player. Audio comes from a signed playback link
 * (mobile.playbackUrl) because native players cannot send the session token
 * on every range request. Lock-screen and Control Center / notification
 * controls are on while it plays, and audio keeps playing in the background.
 */

type PlayerContextValue = {
  currentTime: number;
  duration: number;
  playing: boolean;
  ready: boolean;
  seek(seconds: number, play?: boolean): void;
  toggle(): void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);
export const usePlayer = () => useContext(PlayerContext);

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

export function PlayerProvider({ recordingId, title, knownDuration, startAt, children }: { recordingId: number; title: string; knownDuration?: number | null; startAt?: number; children: ReactNode }) {
  const link = trpc.mobile.playbackUrl.useQuery({ recordingId }, { staleTime: 60 * 60 * 1000, retry: 1 });
  const source = useMemo(() => (link.data ? { uri: apiUrl(link.data.path) } : null), [link.data]);
  const player = useAudioPlayer(source, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const lockScreenOn = useRef(false);
  const startedAt = useRef(false);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (status.playing && !lockScreenOn.current) {
      lockScreenOn.current = true;
      try {
        player.setActiveForLockScreen(true, { title, artist: "StudyScribe" }, { showSeekBackward: true, showSeekForward: true });
      } catch {
        // Not supported on this platform (web preview).
      }
    }
  }, [status.playing, player, title]);

  useEffect(
    () => () => {
      try {
        if (lockScreenOn.current) player.clearLockScreenControls();
      } catch {
        // Player already released.
      }
    },
    [player],
  );

  // Opened from a citation or a notification at a moment: seek there once loaded.
  useEffect(() => {
    if (!status.isLoaded || startedAt.current || !startAt) return;
    startedAt.current = true;
    player.seekTo(startAt).catch(() => undefined);
  }, [status.isLoaded, startAt, player]);

  const duration = status.duration > 0 && Number.isFinite(status.duration) ? status.duration : knownDuration ?? 0;
  const value = useMemo<PlayerContextValue>(
    () => ({
      currentTime: status.currentTime,
      duration,
      playing: status.playing,
      ready: status.isLoaded,
      seek(seconds, play) {
        player.seekTo(Math.max(0, seconds)).catch(() => undefined);
        if (play && !status.playing) player.play();
      },
      toggle() {
        if (status.playing) player.pause();
        else {
          if (status.didJustFinish || (duration && status.currentTime >= duration - 0.5)) player.seekTo(0).catch(() => undefined);
          player.play();
        }
      },
    }),
    [status.currentTime, status.playing, status.isLoaded, status.didJustFinish, duration, player],
  );

  return (
    <PlayerContext.Provider value={value}>
      <PlayerHandle.Provider value={player}>{children}</PlayerHandle.Provider>
    </PlayerContext.Provider>
  );
}

const PlayerHandle = createContext<Player | null>(null);

export function PlayerControls() {
  const context = usePlayer();
  const player = useContext(PlayerHandle);
  const theme = useTheme();
  const [width, setWidth] = useState(1);
  const [speedIndex, setSpeedIndex] = useState(0);
  if (!context || !player) return null;
  const { currentTime, duration, playing, ready, seek, toggle } = context;
  const fraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-4">
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityValue={{ text: `${formatTimestamp(currentTime)} of ${duration ? formatTimestamp(duration) : "unknown"}` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => seek(currentTime + (event.nativeEvent.actionName === "increment" ? 15 : -15))}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width || 1)}
        onPress={(event) => duration && seek((event.nativeEvent.locationX / width) * duration)}
        className="h-6 justify-center"
      >
        <View className="h-1.5 overflow-hidden rounded-full bg-muted">
          <View className="h-full rounded-full bg-primary" style={{ width: `${fraction * 100}%` }} />
        </View>
        <View className="absolute h-4 w-4 rounded-full border-2 border-card bg-primary" style={{ left: Math.max(0, fraction * width - 8) }} />
      </Pressable>
      <View className="flex-row items-center justify-between">
        <Text variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
          {formatTimestamp(currentTime)}
        </Text>
        <Text variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
          {duration ? formatTimestamp(duration) : "--:--"}
        </Text>
      </View>
      <View className="flex-row items-center justify-center gap-6">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${SPEEDS[speedIndex]}x`}
          accessibilityHint="Changes the speed"
          onPress={() => {
            const next = (speedIndex + 1) % SPEEDS.length;
            setSpeedIndex(next);
            player.setPlaybackRate(SPEEDS[next]);
          }}
          className="h-11 w-14 items-center justify-center rounded-full active:bg-muted"
        >
          <Text variant="label">{SPEEDS[speedIndex]}x</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Back 15 seconds" onPress={() => seek(currentTime - 15)} className="h-11 w-11 items-center justify-center rounded-full active:bg-muted">
          <RotateCcw size={22} color={theme.foreground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause" : "Play"}
          disabled={!ready}
          onPress={toggle}
          className="h-14 w-14 items-center justify-center rounded-full bg-primary active:bg-brand-deep"
          style={{ opacity: ready ? 1 : 0.5 }}
        >
          {playing ? <Pause size={24} color={theme.primaryForeground} fill={theme.primaryForeground} /> : <Play size={24} color={theme.primaryForeground} fill={theme.primaryForeground} />}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Forward 15 seconds" onPress={() => seek(currentTime + 15)} className="h-11 w-11 items-center justify-center rounded-full active:bg-muted">
          <RotateCw size={22} color={theme.foreground} />
        </Pressable>
        <View className="w-14" />
      </View>
    </View>
  );
}

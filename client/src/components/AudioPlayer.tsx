import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Play, Pause, Volume2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

interface AudioPlayerProps {
  src: string;
  title?: string;
  onTimeUpdate?: (time: number) => void;
}

export interface AudioPlayerHandle {
  seekTo: (time: number, options?: { play?: boolean }) => void;
}

/** Reads one byte to learn the real HTTP status behind an opaque media error. */
async function probeSource(src: string): Promise<string | null> {
  try {
    const response = await fetch(src, { headers: { Range: "bytes=0-0" }, credentials: "include" });
    if (response.ok || response.status === 206) {
      return `server returned ${response.status}, type ${response.headers.get("content-type") || "unknown"}`;
    }
    const body = await response.text().catch(() => "");
    return `server returned ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`;
  } catch {
    return null;
  }
}

function describeMediaError(error: MediaError | null): string | null {
  if (!error) return null;
  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Playback was cancelled before the recording finished loading.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "The recording could not be downloaded. Check your connection and try again.";
    case MediaError.MEDIA_ERR_DECODE:
      return "The recording is corrupted or incomplete and could not be decoded.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "The recording is missing from storage or is in a format this browser cannot play.";
    default:
      return error.message || "This recording could not be played.";
  }
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer({ src, title = "Recording", onTimeUpdate }: AudioPlayerProps, ref) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);

  const seekTo = useCallback((time: number, options?: { play?: boolean }) => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = Math.max(0, time);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
    if (options?.play) {
      void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  }, []);

  useImperativeHandle(ref, () => ({ seekTo }), [seekTo]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      onTimeUpdate?.(audio.currentTime);
    };
    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setLoadError(null);
    };
    const handleEnded = () => setIsPlaying(false);
    // Without this the element fails silently: the file 404s or can't be
    // decoded, the play button still flips to "Pause", and the user just
    // hears nothing with no indication anything went wrong.
    const handleError = () => {
      setIsPlaying(false);
      setLoadError(describeMediaError(audio.error));
      // The media element never reports *why* the fetch failed, so probe the
      // same URL for the real status. A 401/403/404/502 here is a server
      // problem, not an unplayable file, and saying so turns an unactionable
      // "cannot play" into something diagnosable.
      void probeSource(src).then((detail) => {
        if (detail) setLoadError((current) => (current ? `${current} (${detail})` : detail));
      });
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    // The element starts loading as soon as it mounts, so a cached or fast
    // response can fire `error`/`loadedmetadata` before this effect ever runs.
    // Without replaying them here the error banner only appeared after the
    // user clicked play and hit silence, and the duration stayed at 0:00.
    if (audio.error) handleError();
    else if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) handleLoadedMetadata();

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [onTimeUpdate, src]);

  const togglePlayPause = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      await audio.play();
      setIsPlaying(true);
      setLoadError(null);
    } catch (error) {
      setIsPlaying(false);
      setLoadError(
        describeMediaError(audio.error) ||
          (error instanceof Error ? error.message : "This recording could not be played."),
      );
    }
  };

  const handleSeek = (value: number[]) => seekTo(value[0]);

  const handleSpeedChange = (speed: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
      setPlaybackRate(speed);
    }
  };

  const formatTime = (time: number) => {
    if (!time || isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4 p-4 bg-card rounded-lg border border-border">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">{title}</h3>
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{playbackRate}x</span>
        </div>
      </div>

      <audio ref={audioRef} src={src} preload="metadata" />

      {loadError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
          <p className="text-xs leading-relaxed text-destructive">{loadError}</p>
        </div>
      )}

      {/* Play/Pause Button */}
      <div className="flex items-center gap-4">
        <Button
          size="sm"
          variant="outline"
          onClick={togglePlayPause}
          disabled={!!loadError}
          className="gap-2"
        >
          {isPlaying ? (
            <>
              <Pause className="w-4 h-4" />
              Pause
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Play
            </>
          )}
        </Button>
        <span className="text-xs text-muted-foreground min-w-12">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      {/* Progress Slider */}
      <Slider
        value={[currentTime]}
        min={0}
        max={duration || 100}
        step={0.1}
        onValueChange={handleSeek}
        className="w-full"
      />

      {/* Speed Controls */}
      <div className="flex gap-2 flex-wrap">
        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
          <Button
            key={speed}
            size="sm"
            variant={playbackRate === speed ? "default" : "outline"}
            onClick={() => handleSpeedChange(speed)}
            className="text-xs"
          >
            {speed}x
          </Button>
        ))}
      </div>
    </div>
  );
});

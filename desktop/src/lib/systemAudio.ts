/**
 * How the desktop shell answers the web app's `getDisplayMedia` call, which
 * is what "Add tab or screen audio" on the record page uses (A3). Inside
 * Electron there is no browser picker, so the main process picks a screen
 * and asks the system for its audio.
 *
 * - Windows: WASAPI loopback ("loopback"), everything the computer plays.
 * - macOS 13+: ScreenCaptureKit system audio. The app needs Screen Recording
 *   permission (System Settings > Privacy & Security), and on macOS 15 the
 *   system picker is used so the person chooses what to share.
 * - Linux: PulseAudio/PipeWire monitor of the default output, where
 *   Chromium supports it; otherwise the share has no audio track and the web
 *   app says so.
 */

export type Platform = "darwin" | "win32" | "linux" | string;

export type SystemAudioSupport = {
  /** Whether the shell offers system audio at all on this platform. */
  available: boolean;
  method: "wasapi-loopback" | "screencapturekit" | "pulseaudio-monitor" | "none";
  /** One sentence for the person, shown in the shell's own UI and docs. */
  note: string;
};

export function systemAudioSupport(platform: Platform, osRelease = ""): SystemAudioSupport {
  if (platform === "win32") {
    return { available: true, method: "wasapi-loopback", note: "Records everything this computer plays, such as a Zoom call or a video." };
  }
  if (platform === "darwin") {
    // Darwin 22 is macOS 13, the first with ScreenCaptureKit audio.
    const major = Number.parseInt(osRelease.split(".")[0] ?? "", 10);
    if (Number.isFinite(major) && major < 22) {
      return { available: false, method: "none", note: "System audio needs macOS 13 or later." };
    }
    return { available: true, method: "screencapturekit", note: "Needs Screen Recording permission for StudyScribe in System Settings." };
  }
  if (platform === "linux") {
    return { available: true, method: "pulseaudio-monitor", note: "Uses the PulseAudio or PipeWire monitor of your speakers, where available." };
  }
  return { available: false, method: "none", note: "System audio is not available on this system." };
}

/** Electron's `audio` answer for a display-media request. */
export function loopbackFor(support: SystemAudioSupport): "loopback" | undefined {
  return support.available ? "loopback" : undefined;
}

type SourceLike = { id: string; name: string; display_id?: string };

/** The screen to share: the one the window is on when known, else the first screen. */
export function pickScreen<T extends SourceLike>(sources: T[], displayId?: number): T | undefined {
  const screens = sources.filter(source => source.id.startsWith("screen:"));
  if (displayId !== undefined) {
    const match = screens.find(source => source.display_id === String(displayId));
    if (match) return match;
  }
  return screens[0];
}

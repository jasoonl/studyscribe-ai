/**
 * Wall-clock timing for a recording that can be paused.
 *
 * Browsers throttle timers in background tabs (Chrome drops `setInterval` to
 * about once a minute after a few minutes hidden), so counting ticks makes a
 * lecture recorded in another tab come out far too short. Elapsed time is
 * instead derived from timestamps; a ticking interval is only used to re-render.
 */
export type RecordingClock = {
  /** When the current running stretch began, or null while paused/stopped. */
  runningSince: number | null;
  /** Time recorded in stretches that have already ended. */
  accumulatedMs: number;
};

export const idleClock: RecordingClock = { runningSince: null, accumulatedMs: 0 };

export function startClock(now: number): RecordingClock {
  return { runningSince: now, accumulatedMs: 0 };
}

export function pauseClock(clock: RecordingClock, now: number): RecordingClock {
  if (clock.runningSince === null) return clock;
  return { runningSince: null, accumulatedMs: clock.accumulatedMs + Math.max(0, now - clock.runningSince) };
}

export function resumeClock(clock: RecordingClock, now: number): RecordingClock {
  if (clock.runningSince !== null) return clock;
  return { runningSince: now, accumulatedMs: clock.accumulatedMs };
}

export function elapsedMs(clock: RecordingClock, now: number): number {
  const running = clock.runningSince === null ? 0 : Math.max(0, now - clock.runningSince);
  return clock.accumulatedMs + running;
}

export function elapsedSeconds(clock: RecordingClock, now: number): number {
  return Math.floor(elapsedMs(clock, now) / 1000);
}

/** mm:ss, or h:mm:ss once a recording passes an hour. */
export function formatClockTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

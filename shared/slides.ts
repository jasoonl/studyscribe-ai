/**
 * Slide capture (A6): while a recording includes a shared tab or screen and
 * the person opted in, a frame is kept whenever the picture changes
 * meaningfully, at most once every MIN_SLIDE_GAP_SECONDS.
 *
 * The comparison is deliberately cheap: each sample is shrunk to a 32x18
 * grid of average brightness (a "signature") and compared cell by cell.
 *  - A new slide must differ from the last kept one in at least
 *    CHANGED_CELLS_FOR_NEW_SLIDE of the cells, so a moving cursor, a
 *    blinking caret or a clock in a corner do not count.
 *  - It must also be steady: nearly the same as the sample before it, so a
 *    slide transition is captured once it settles and a playing video does
 *    not produce a stream of frames.
 *
 * Storage is the binding limit (Vercel Blob on the Hobby plan holds 1GB in
 * total), so frames are JPEG at reduced quality, no larger than
 * SLIDE_MAX_EDGE on their long edge, and capped at MAX_SLIDES_PER_RECORDING.
 */

export const SIGNATURE_WIDTH = 32;
export const SIGNATURE_HEIGHT = 18;
export const SLIDE_SAMPLE_INTERVAL_MS = 2_000;
export const MIN_SLIDE_GAP_SECONDS = 8;
export const MAX_SLIDES_PER_RECORDING = 40;
export const SLIDE_MAX_EDGE = 1280;
export const SLIDE_JPEG_QUALITY = 0.7;
export const MAX_SLIDE_BYTES = 400 * 1024;
/** A cell counts as changed when its brightness moved by more than this (0 to 1). */
export const CELL_CHANGE = 0.1;
export const CHANGED_CELLS_FOR_NEW_SLIDE = 0.08;
/** Two consecutive samples this close are "steady". */
export const STEADY_CHANGED_CELLS = 0.02;

export type Signature = Float32Array;

/**
 * Averages RGBA pixels (already drawn at, or larger than, the signature size)
 * into a grid of brightness values between 0 and 1.
 */
export function toSignature(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, gridWidth = SIGNATURE_WIDTH, gridHeight = SIGNATURE_HEIGHT): Signature {
  const sums = new Float32Array(gridWidth * gridHeight);
  const counts = new Uint32Array(gridWidth * gridHeight);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(gridHeight - 1, Math.floor((y * gridHeight) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(gridWidth - 1, Math.floor((x * gridWidth) / width));
      const i = (y * width + x) * 4;
      // Rec. 601 luma.
      const luma = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
      sums[gy * gridWidth + gx] += luma;
      counts[gy * gridWidth + gx] += 1;
    }
  }
  for (let i = 0; i < sums.length; i++) sums[i] = counts[i] ? sums[i] / counts[i] : 0;
  return sums;
}

/** Share of cells whose brightness changed by more than CELL_CHANGE. */
export function changedFraction(a: Signature, b: Signature, threshold = CELL_CHANGE) {
  if (a.length !== b.length || a.length === 0) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > threshold) changed++;
  return changed / a.length;
}

/** Nearly every cell has the same brightness: a blank or black screen, not worth keeping. */
export function isBlank(signature: Signature) {
  if (signature.length === 0) return true;
  let min = 1;
  let max = 0;
  for (let i = 0; i < signature.length; i++) {
    const value = signature[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min < 0.03;
}

export type SlideDecisionState = {
  /** Signature of the last kept slide, or null before the first. */
  lastKept: Signature | null;
  /** Recording time of the last kept slide. */
  lastKeptAt: number | null;
  /** The sample just before this one. */
  previous: Signature | null;
  kept: number;
};

export const initialSlideState = (): SlideDecisionState => ({ lastKept: null, lastKeptAt: null, previous: null, kept: 0 });

/**
 * Whether to keep the frame sampled at `atSeconds`. Pure, so the rule is
 * unit tested; the capturer feeds it every sample and updates the state.
 */
export function decideSlide(state: SlideDecisionState, sample: Signature, atSeconds: number, limits = { maxSlides: MAX_SLIDES_PER_RECORDING, minGapSeconds: MIN_SLIDE_GAP_SECONDS }): { keep: boolean; state: SlideDecisionState } {
  const steady = state.previous !== null && changedFraction(state.previous, sample) <= STEADY_CHANGED_CELLS;
  const next: SlideDecisionState = { ...state, previous: sample };
  if (state.kept >= limits.maxSlides || !steady || isBlank(sample)) return { keep: false, state: next };
  if (state.lastKeptAt !== null && atSeconds - state.lastKeptAt < limits.minGapSeconds) return { keep: false, state: next };
  const different = state.lastKept === null || changedFraction(state.lastKept, sample) >= CHANGED_CELLS_FOR_NEW_SLIDE;
  if (!different) return { keep: false, state: next };
  return { keep: true, state: { lastKept: sample, lastKeptAt: atSeconds, previous: sample, kept: state.kept + 1 } };
}

/** Scales a frame so its long edge is at most SLIDE_MAX_EDGE, keeping the aspect ratio. */
export function fitSlideSize(width: number, height: number, maxEdge = SLIDE_MAX_EDGE) {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The slide shown at a moment: the last one captured at or before it. */
export function slideAt<T extends { atSeconds: number }>(slides: T[], seconds: number): T | null {
  let found: T | null = null;
  for (const slide of slides) {
    if (slide.atSeconds <= seconds + 0.001) found = slide;
    else break;
  }
  return found;
}

/** Groups slides by the transcript line they belong before: a slide shows above the first line that starts at or after it. */
export function slidesBeforeSegments<T extends { atSeconds: number }>(slides: T[], segmentStarts: number[]) {
  const before = new Map<number, T[]>();
  const after: T[] = [];
  let line = 0;
  for (const slide of slides) {
    while (line < segmentStarts.length && segmentStarts[line] < slide.atSeconds) line++;
    if (line >= segmentStarts.length) after.push(slide);
    else before.set(line, [...(before.get(line) ?? []), slide]);
  }
  return { before, after };
}

import {
  MAX_SLIDES_PER_RECORDING,
  MIN_SLIDE_GAP_SECONDS,
  SIGNATURE_HEIGHT,
  SIGNATURE_WIDTH,
  SLIDE_JPEG_QUALITY,
  SLIDE_SAMPLE_INTERVAL_MS,
  decideSlide,
  fitSlideSize,
  initialSlideState,
  toSignature,
  type SlideDecisionState,
} from "@shared/slides";

export type CapturedSlide = { atSeconds: number; blob: Blob; width: number; height: number };

type FrameSource = { width: number; height: number; draw: (context: CanvasRenderingContext2D, width: number, height: number) => void; close?: () => void };

type ImageCaptureLike = { grabFrame: () => Promise<ImageBitmap> };

/**
 * Keeps slides from a shared tab's or screen's video track (A6).
 *
 * Every SLIDE_SAMPLE_INTERVAL_MS it takes a frame, shrinks it to a 32x18
 * brightness grid and lets `decideSlide` (shared/slides.ts) say whether it is
 * a new, steady slide; kept frames are encoded as JPEG at a capped size.
 *
 * The person is usually looking at the shared tab, so the StudyScribe tab is
 * in the background, where Chrome throttles timers and may stop painting a
 * <video>. So the tick comes from a small worker, and frames are taken with
 * ImageCapture.grabFrame() from the track itself where available.
 */
export class SlideCapturer {
  private state: SlideDecisionState = initialSlideState();
  private slides: CapturedSlide[] = [];
  private worker: Worker | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private video: HTMLVideoElement | null = null;
  private imageCapture: ImageCaptureLike | null = null;
  private small: HTMLCanvasElement | null = null;
  private busy = false;
  private stopped = false;

  constructor(
    private readonly track: MediaStreamTrack,
    private readonly options: {
      /** Seconds into the recording now (pause-aware). */
      elapsedSeconds: () => number;
      /** True while the recording is paused; nothing is captured then. */
      isPaused: () => boolean;
      onSlide?: (count: number) => void;
      /** Slides this capturer may still keep (a recording can share several times). */
      maxSlides?: number;
    },
  ) {}

  start() {
    const Capture = (window as unknown as { ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
    if (Capture) {
      try {
        this.imageCapture = new Capture(this.track);
      } catch {
        this.imageCapture = null;
      }
    }
    if (!this.imageCapture) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([this.track]);
      void video.play().catch(() => {});
      this.video = video;
    }
    this.small = document.createElement("canvas");
    this.small.width = SIGNATURE_WIDTH;
    this.small.height = SIGNATURE_HEIGHT;

    try {
      const source = `setInterval(function(){postMessage(0)},${SLIDE_SAMPLE_INTERVAL_MS});`;
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = () => void this.tick();
    } catch {
      this.fallbackTimer = setInterval(() => void this.tick(), SLIDE_SAMPLE_INTERVAL_MS);
    }
  }

  stop() {
    this.stopped = true;
    this.worker?.terminate();
    this.worker = null;
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = null;
    }
  }

  get count() {
    return this.slides.length;
  }

  takeSlides() {
    return [...this.slides];
  }

  private async grab(): Promise<FrameSource | null> {
    if (this.track.readyState !== "live") return null;
    if (this.imageCapture) {
      try {
        const bitmap = await this.imageCapture.grabFrame();
        return { width: bitmap.width, height: bitmap.height, draw: (context, w, h) => context.drawImage(bitmap, 0, 0, w, h), close: () => bitmap.close() };
      } catch {
        return null;
      }
    }
    const video = this.video;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    return { width: video.videoWidth, height: video.videoHeight, draw: (context, w, h) => context.drawImage(video, 0, 0, w, h) };
  }

  private async tick() {
    if (this.busy || this.stopped || this.options.isPaused()) return;
    this.busy = true;
    let frame: FrameSource | null = null;
    try {
      frame = await this.grab();
      if (!frame || !this.small) return;
      const smallContext = this.small.getContext("2d", { willReadFrequently: true });
      if (!smallContext) return;
      frame.draw(smallContext, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
      const pixels = smallContext.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT).data;
      const atSeconds = this.options.elapsedSeconds();
      const decision = decideSlide(this.state, toSignature(pixels, SIGNATURE_WIDTH, SIGNATURE_HEIGHT), atSeconds, {
        maxSlides: this.options.maxSlides ?? MAX_SLIDES_PER_RECORDING,
        minGapSeconds: MIN_SLIDE_GAP_SECONDS,
      });
      this.state = decision.state;
      if (!decision.keep) return;

      const size = fitSlideSize(frame.width, frame.height);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      frame.draw(context, size.width, size.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", SLIDE_JPEG_QUALITY));
      if (!blob || this.stopped) return;
      this.slides.push({ atSeconds, blob, width: size.width, height: size.height });
      this.options.onSlide?.(this.slides.length);
    } catch {
      // A frame that cannot be read is skipped; the next tick tries again.
    } finally {
      frame?.close?.();
      this.busy = false;
    }
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the slide"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Uploads captured slides after the recording is saved, one request each so
 * no request carries more than one image. Stops at the first refusal (storage
 * full, or the per-recording cap) and reports how many were saved.
 */
export async function uploadSlides(
  recordingId: number,
  slides: CapturedSlide[],
  add: (input: { recordingId: number; atSeconds: number; imageBase64: string }) => Promise<unknown>,
): Promise<{ saved: number; error: string | null }> {
  let saved = 0;
  for (const slide of slides) {
    try {
      await add({ recordingId, atSeconds: slide.atSeconds, imageBase64: await blobToBase64(slide.blob) });
      saved++;
    } catch (error) {
      return { saved, error: error instanceof Error ? error.message : "Slides could not be saved" };
    }
  }
  return { saved, error: null };
}

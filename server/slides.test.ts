import { describe, expect, it } from "vitest";
import {
  MAX_SLIDES_PER_RECORDING,
  MIN_SLIDE_GAP_SECONDS,
  changedFraction,
  decideSlide,
  fitSlideSize,
  initialSlideState,
  isBlank,
  slideAt,
  slidesBeforeSegments,
  toSignature,
  type Signature,
} from "@shared/slides";
import { decodeSlideImage, jpegDimensions } from "./slides";

const W = 64;
const H = 36;

/** An RGBA frame: white background, optional dark rectangles (x, y, w, h in pixels). */
function frame(rects: Array<[number, number, number, number]> = [], background = 255) {
  const data = new Uint8ClampedArray(W * H * 4).fill(background);
  for (const [rx, ry, rw, rh] of rects) {
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 20;
    }
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return data;
}

const sig = (rects: Array<[number, number, number, number]>, background = 255): Signature => toSignature(frame(rects, background), W, H);

const slideOne = sig([[4, 4, 40, 6], [4, 14, 30, 4], [4, 22, 34, 4]]);
const slideOneWithCursor = sig([[4, 4, 40, 6], [4, 14, 30, 4], [4, 22, 34, 4], [56, 30, 2, 2]]);
const slideTwo = sig([[10, 2, 20, 20], [36, 24, 24, 8]]);

/** Runs samples through the decision rule and returns the times that were kept. */
function run(samples: Array<[number, Signature]>) {
  let state = initialSlideState();
  const kept: number[] = [];
  for (const [at, sample] of samples) {
    const decision = decideSlide(state, sample, at);
    state = decision.state;
    if (decision.keep) kept.push(at);
  }
  return kept;
}

describe("frame signatures", () => {
  it("averages brightness into a 32x18 grid", () => {
    const white = sig([]);
    expect(white).toHaveLength(32 * 18);
    expect(white[0]).toBeCloseTo(1, 2);
    expect(isBlank(white)).toBe(true);
    expect(isBlank(slideOne)).toBe(false);
  });

  it("sees a cursor as a tiny change and a new slide as a large one", () => {
    expect(changedFraction(slideOne, slideOneWithCursor)).toBeLessThan(0.02);
    expect(changedFraction(slideOne, slideTwo)).toBeGreaterThan(0.08);
    expect(changedFraction(slideOne, slideOne)).toBe(0);
  });
});

describe("decideSlide", () => {
  it("keeps the first steady slide and each new steady one", () => {
    const kept = run([
      [0, slideOne],
      [2, slideOne],
      [4, slideOneWithCursor],
      [6, slideOne],
      [20, slideTwo],
      [22, slideTwo],
    ]);
    expect(kept).toEqual([2, 22]);
  });

  it("ignores a cursor moving over the same slide", () => {
    const kept = run([[0, slideOne], [2, slideOne], [12, slideOneWithCursor], [14, slideOneWithCursor], [24, slideOne], [26, slideOne]]);
    expect(kept).toEqual([2]);
  });

  it("waits for a change to settle, so a playing video does not flood it", () => {
    // Alternating pictures never settle.
    const kept = run(Array.from({ length: 20 }, (_, i) => [i * 2, i % 2 ? slideOne : slideTwo] as [number, Signature]));
    expect(kept).toEqual([]);
  });

  it("keeps at most one slide every MIN_SLIDE_GAP_SECONDS", () => {
    const kept = run([[0, slideOne], [2, slideOne], [4, slideTwo], [6, slideTwo], [8, slideTwo], [10, slideTwo]]);
    // The second slide was steady from 6s but had to wait for the gap.
    expect(kept).toEqual([2, 10]);
    expect(kept[0]).toBe(2);
    expect(kept[1] - kept[0]).toBeGreaterThanOrEqual(MIN_SLIDE_GAP_SECONDS);
  });

  it("skips blank screens", () => {
    expect(run([[0, sig([])], [2, sig([])], [4, sig([], 0)], [6, sig([], 0)]])).toEqual([]);
  });

  it("stops at the per-recording cap", () => {
    let state = { ...initialSlideState(), kept: MAX_SLIDES_PER_RECORDING };
    state = decideSlide(state, slideOne, 0).state;
    expect(decideSlide(state, slideOne, 100).keep).toBe(false);
  });
});

describe("slide placement and sizing", () => {
  it("caps the long edge and keeps the aspect ratio", () => {
    expect(fitSlideSize(2560, 1440)).toEqual({ width: 1280, height: 720 });
    expect(fitSlideSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(fitSlideSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("finds the slide on screen at a time", () => {
    const slides = [{ atSeconds: 10 }, { atSeconds: 40 }];
    expect(slideAt(slides, 5)).toBeNull();
    expect(slideAt(slides, 10)).toEqual({ atSeconds: 10 });
    expect(slideAt(slides, 100)).toEqual({ atSeconds: 40 });
  });

  it("places each slide above the first transcript line at or after it", () => {
    const { before, after } = slidesBeforeSegments([{ atSeconds: 0 }, { atSeconds: 65 }, { atSeconds: 500 }], [0, 30, 60, 70, 90]);
    expect(before.get(0)).toEqual([{ atSeconds: 0 }]);
    expect(before.get(3)).toEqual([{ atSeconds: 65 }]);
    expect(after).toEqual([{ atSeconds: 500 }]);
  });
});

/** A minimal baseline JPEG header: SOI, an APP0 segment, then SOF0 with the size. */
function fakeJpeg(width: number, height: number) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

describe("slide uploads", () => {
  it("reads JPEG dimensions and rejects other files", () => {
    expect(jpegDimensions(fakeJpeg(1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(jpegDimensions(Buffer.from("\x89PNG\r\n\x1a\n0000000000", "binary"))).toBeNull();
  });

  it("accepts a small JPEG and refuses oversized or non-JPEG images", () => {
    expect(decodeSlideImage(`data:image/jpeg;base64,${fakeJpeg(1280, 720).toString("base64")}`)).toMatchObject({ width: 1280, height: 720 });
    expect(() => decodeSlideImage(fakeJpeg(3840, 2160).toString("base64"))).toThrow(/1280/);
    expect(() => decodeSlideImage(Buffer.from("GIF89a-not-a-jpeg").toString("base64"))).toThrow(/JPEG/);
    expect(() => decodeSlideImage(Buffer.concat([fakeJpeg(100, 100), Buffer.alloc(500 * 1024)]).toString("base64"))).toThrow(/KB/);
  });
});

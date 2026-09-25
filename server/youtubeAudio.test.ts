import { afterEach, describe, expect, it, vi } from "vitest";

const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookup(...args) }));

import {
  describePlayabilityFailure,
  isYouTubeNonVideoLink,
  parseYouTubeVideoId,
  pickAudioFormat,
  probeYouTubeClients,
  resolveYouTubeAudio,
  youtubeAudioStream,
} from "./youtubeAudio";
import { fetchAudioFromUrl } from "./urlAudioImport";

afterEach(() => {
  vi.unstubAllGlobals();
  lookup.mockReset();
});

const ID = "jNQXAC9IVRw";
const CDN = "https://rr1---sn-abc.googlevideo.com/videoplayback?id=1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function okPlayer(overrides: Record<string, unknown> = {}) {
  return {
    playabilityStatus: { status: "OK" },
    videoDetails: { title: "Me at the zoo", lengthSeconds: "19" },
    streamingData: {
      adaptiveFormats: [
        { itag: 137, url: CDN, mimeType: "video/mp4; codecs=avc1", bitrate: 2_000_000 },
        { itag: 140, url: CDN, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130_000, contentLength: "309288" },
      ],
    },
    ...overrides,
  };
}

describe("parseYouTubeVideoId", () => {
  it("reads the common single-video link shapes", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
    ]) {
      expect(parseYouTubeVideoId(url), url).toBe(ID);
    }
  });

  it("rejects links that are not a single video", () => {
    for (const url of [
      "https://www.youtube.com/",
      "https://www.youtube.com/@channel",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=has spaces!!",
      `https://notyoutube.com/watch?v=${ID}`,
      `https://youtube.com.evil.example/watch?v=${ID}`,
      `ftp://youtube.com/watch?v=${ID}`,
      "not a url",
    ]) {
      expect(parseYouTubeVideoId(url), url).toBeNull();
    }
  });

  it("identifies a YouTube address that has no video, so it can be explained", () => {
    expect(isYouTubeNonVideoLink("https://www.youtube.com/@channel")).toBe(true);
    expect(isYouTubeNonVideoLink(`https://youtu.be/${ID}`)).toBe(false);
    expect(isYouTubeNonVideoLink("https://example.com/")).toBe(false);
  });
});

describe("pickAudioFormat", () => {
  it("prefers AAC in MP4 near 128kbps and ignores video and url-less entries", () => {
    const picked = pickAudioFormat([
      { itag: 137, url: "u", mimeType: "video/mp4", bitrate: 2_000_000 },
      { itag: 139, url: "a", mimeType: "audio/mp4", bitrate: 49_000 },
      { itag: 140, url: "b", mimeType: "audio/mp4", bitrate: 130_000 },
      { itag: 251, url: "c", mimeType: "audio/webm", bitrate: 108_000 },
      { itag: 141, mimeType: "audio/mp4", bitrate: 256_000 },
    ]);
    expect(picked?.itag).toBe(140);
  });

  it("uses only the original language track of a dubbed video", () => {
    const picked = pickAudioFormat([
      { itag: 140, url: "dub", mimeType: "audio/mp4", bitrate: 130_000, audioTrack: { audioIsDefault: false } },
      { itag: 140, url: "orig", mimeType: "audio/mp4", bitrate: 129_000, audioTrack: { audioIsDefault: true } },
    ]);
    expect(picked?.url).toBe("orig");
  });

  it("falls back to WebM audio when no MP4 audio is offered, and to null when nothing is", () => {
    expect(pickAudioFormat([{ url: "w", mimeType: "audio/webm", bitrate: 108_000 }])?.url).toBe("w");
    expect(pickAudioFormat([{ url: "v", mimeType: "video/mp4" }])).toBeNull();
  });
});

describe("describePlayabilityFailure", () => {
  it("explains the bot challenge and age gate in plain terms", () => {
    expect(describePlayabilityFailure("LOGIN_REQUIRED", "Sign in to confirm you’re not a bot")).toMatch(/bot/i);
    expect(describePlayabilityFailure("LOGIN_REQUIRED", "This video may be inappropriate. Sign in to confirm your age")).toMatch(/age-restricted/i);
    expect(describePlayabilityFailure("ERROR", "Video unavailable")).toMatch(/Video unavailable/);
  });
});

describe("resolveYouTubeAudio", () => {
  it("returns the chosen stream with title, duration and length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(okPlayer())));
    const audio = await resolveYouTubeAudio(ID);
    expect(audio).toMatchObject({ title: "Me at the zoo", durationSec: 19, contentLength: 309288, mimeType: "audio/mp4", url: CDN });
  });

  it("falls back to the next client when the first is challenged", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" } }))
      .mockResolvedValueOnce(json(okPlayer()));
    vi.stubGlobal("fetch", fetchMock);
    const audio = await resolveYouTubeAudio(ID);
    expect(audio.title).toBe("Me at the zoo");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const clients = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)).context.client.clientName);
    expect(clients.slice(0, 2)).toEqual(["IOS", "ANDROID_VR"]);
  });

  it("stops early for a private video that no client can play", async () => {
    const fetchMock = vi.fn(async () => json({ playabilityStatus: { status: "ERROR", reason: "This video is private" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveYouTubeAudio(ID)).rejects.toThrow(/private/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unavailable video after trying every client", async () => {
    // Some clients say "unavailable" for healthy videos, so that alone isn't final.
    const fetchMock = vi.fn(async () => json({ playabilityStatus: { status: "ERROR", reason: "Video unavailable" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveYouTubeAudio(ID)).rejects.toThrow(/Video unavailable/);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("explains the bot challenge when every client is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" } })));
    await expect(resolveYouTubeAudio(ID)).rejects.toThrow(/prove it isn't a bot/i);
  });

  it("refuses a live stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(okPlayer({ videoDetails: { title: "Live", isLive: true } }))));
    await expect(resolveYouTubeAudio(ID)).rejects.toThrow(/live stream/i);
  });

  it("refuses a download address that is not YouTube's CDN", async () => {
    const evil = okPlayer({
      streamingData: { adaptiveFormats: [{ itag: 140, url: "http://169.254.169.254/latest/meta-data", mimeType: "audio/mp4", bitrate: 130_000 }] },
    });
    vi.stubGlobal("fetch", vi.fn(async () => json(evil)));
    await expect(resolveYouTubeAudio(ID)).rejects.toThrow(/unexpected download address/i);
  });

  it("reports a network failure reaching YouTube", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    await expect(resolveYouTubeAudio(ID)).rejects.toThrow(/Could not reach YouTube: ECONNRESET/);
  });
});

describe("youtubeAudioStream", () => {
  async function drain(stream: ReadableStream<Uint8Array>) {
    const parts: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    return parts;
  }

  it("downloads in ranged chunks and stops at the declared length", async () => {
    const total = 4 * 1024 * 1024 + 500;
    const fetchMock = vi.fn(async (input: unknown) => {
      const range = new URL(String(input)).searchParams.get("range")!;
      const [start, end] = range.split("-").map(Number);
      return new Response(new Uint8Array(Math.min(end, total - 1) - start + 1), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const parts = await drain(youtubeAudioStream({ url: CDN, contentLength: total, userAgent: "ua" }));
    expect(parts.reduce((sum, part) => sum + part.byteLength, 0)).toBe(total);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("range")).toBe(`${4 * 1024 * 1024}-${8 * 1024 * 1024 - 1}`);
  });

  it("ends on a short chunk when no length was declared", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(1000), { status: 200 })));
    const parts = await drain(youtubeAudioStream({ url: CDN, contentLength: null, userAgent: "ua" }));
    expect(parts).toHaveLength(1);
  });

  it("surfaces a failed chunk as an error instead of a silently truncated file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(drain(youtubeAudioStream({ url: CDN, contentLength: 100, userAgent: "ua" }))).rejects.toThrow(/stopped sending the audio \(403\)/);
  });
});

describe("importing a YouTube link", () => {
  it("resolves the video and streams its audio without any DNS lookup of the pasted host", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/youtubei/v1/player")) return json(okPlayer());
      return new Response(new Uint8Array(309288), { status: 200 });
    }));

    const result = await fetchAudioFromUrl(`https://youtu.be/${ID}?si=share`);
    expect(result).toMatchObject({
      mimeType: "audio/mp4",
      finalUrl: `https://www.youtube.com/watch?v=${ID}`,
      title: "Me at the zoo",
      durationSec: 19,
      contentLength: 309288,
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a file whose audio exceeds the import cap before downloading it", async () => {
    const big = okPlayer({
      streamingData: { adaptiveFormats: [{ itag: 140, url: CDN, mimeType: "audio/mp4", bitrate: 130_000, contentLength: String(600 * 1024 * 1024) }] },
    });
    const fetchMock = vi.fn(async () => json(big));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAudioFromUrl(`https://www.youtube.com/watch?v=${ID}`)).rejects.toThrow(/larger than/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explains a channel or playlist link instead of trying to scrape it", async () => {
    await expect(fetchAudioFromUrl("https://www.youtube.com/@somechannel")).rejects.toThrow(/single video/i);
  });
});

describe("probeYouTubeClients", () => {
  it("reports each client's outcome so an admin can see what this network is allowed", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () =>
      ++call === 1
        ? json(okPlayer())
        : json({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" } }),
    ));
    const results = await probeYouTubeClients(ID);
    expect(results.length).toBeGreaterThan(2);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.detail).toMatch(/bot/i);
  });
});

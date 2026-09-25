import { describe, expect, it, vi, afterEach } from "vitest";

const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookup(...args) }));

import {
  isDisallowedAddress,
  assertPublicHttpUrl,
  guessMimeTypeFromUrl,
  limitStreamSize,
  fetchAudioFromUrl,
} from "./urlAudioImport";
import { normalizeAudioMimeType } from "./storage";

afterEach(() => {
  vi.unstubAllGlobals();
  lookup.mockReset();
});

function publicDns() {
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<number> {
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
  }
  return total;
}

describe("isDisallowedAddress", () => {
  it("blocks loopback, private, and carrier-grade NAT ranges", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.1", "100.64.0.1"]) {
      expect(isDisallowedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks cloud instance metadata", () => {
    // The classic SSRF target — credentials live here on most cloud providers.
    expect(isDisallowedAddress("169.254.169.254")).toBe(true);
  });

  it("blocks IPv6 loopback, unique-local, and link-local", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isDisallowedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks IPv4-mapped IPv6 that hides a private address", () => {
    expect(isDisallowedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isDisallowedAddress("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows ordinary public addresses", () => {
    expect(isDisallowedAddress("93.184.216.34")).toBe(false);
    expect(isDisallowedAddress("8.8.8.8")).toBe(false);
    expect(isDisallowedAddress("2606:2800:220:1::1")).toBe(false);
  });

  it("refuses anything that is not a valid address rather than guessing", () => {
    expect(isDisallowedAddress("not-an-ip")).toBe(true);
  });
});

describe("assertPublicHttpUrl", () => {
  it("rejects non-http schemes including file and gopher", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow(/http and https/i);
    await expect(assertPublicHttpUrl("gopher://example.com/")).rejects.toThrow(/http and https/i);
  });

  it("rejects a literal private IP without any DNS lookup", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/audio.mp3")).rejects.toThrow(/private address/i);
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/private address/i);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a public hostname that resolves to a private address", async () => {
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertPublicHttpUrl("https://evil.example/audio.mp3")).rejects.toThrow(/private address/i);
  });

  it("rejects when any one of several resolved addresses is private", async () => {
    lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(assertPublicHttpUrl("https://mixed.example/audio.mp3")).rejects.toThrow(/private address/i);
  });

  it("accepts a normal public https link", async () => {
    publicDns();
    const url = await assertPublicHttpUrl("https://example.com/talk.mp3");
    expect(url.hostname).toBe("example.com");
  });

  it("explains why streaming pages can't be imported instead of failing cryptically", async () => {
    for (const link of [
      "https://music.youtube.com/watch?v=abc123",
      "https://open.spotify.com/episode/abc",
      "https://vimeo.com/12345",
    ]) {
      await expect(assertPublicHttpUrl(link), link).rejects.toThrow(/can't be imported/i);
    }
  });

  it("does not block a lookalike hostname that merely contains a blocked name", async () => {
    publicDns();
    // "myyoutube.com" is a different site and must not be swept up.
    const url = await assertPublicHttpUrl("https://myyoutube.com/talk.mp3");
    expect(url.hostname).toBe("myyoutube.com");
  });
});

describe("guessMimeTypeFromUrl", () => {
  it("maps common lecture audio extensions", () => {
    expect(guessMimeTypeFromUrl("https://example.com/talk.mp3")).toBe("audio/mpeg");
    expect(guessMimeTypeFromUrl("https://example.com/lecture.m4a")).toBe("audio/mp4");
    expect(guessMimeTypeFromUrl("https://example.com/a.ogg")).toBe("audio/ogg");
    expect(guessMimeTypeFromUrl("https://example.com/a.wav?x=1")).toBe("audio/wav");
  });

  it("returns null for a non-audio extension", () => {
    expect(guessMimeTypeFromUrl("https://example.com/page.html")).toBeNull();
  });

  it("maps video containers, whose audio track is what gets transcribed", () => {
    expect(guessMimeTypeFromUrl("https://example.com/talk.mp4")).toBe("audio/mp4");
    expect(guessMimeTypeFromUrl("https://example.com/lecture.mov")).toBe("video/quicktime");
    expect(guessMimeTypeFromUrl("https://example.com/keynote.webm")).toBe("audio/webm");
  });
});

describe("importing video links", () => {
  it("accepts an MP4 video talk and normalizes it to an audio container", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("video", { status: 200, headers: { "content-type": "video/mp4" } }),
    ));
    const result = await fetchAudioFromUrl("https://example.com/conference-talk.mp4");
    expect(normalizeAudioMimeType(result.mimeType)).toBe("audio/mp4");
  });

  it("accepts a QuickTime link", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("video", { status: 200, headers: { "content-type": "video/quicktime" } }),
    ));
    const result = await fetchAudioFromUrl("https://example.com/lecture.mov");
    expect(normalizeAudioMimeType(result.mimeType)).toBe("audio/mp4");
  });

  it("still refuses a web page that merely links to media", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } }),
    ));
    await expect(fetchAudioFromUrl("https://example.com/watch")).rejects.toThrow(/not an audio file/i);
  });
});

describe("importing from a page that publishes the media", () => {
  function html(body: string) {
    return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  function audio() {
    return new Response("bytes", { status: 200, headers: { "content-type": "audio/mpeg" } });
  }

  it("follows an Open Graph media link on a page to the real file", async () => {
    publicDns();
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/details/talk")) {
        return html('<meta property="og:video" content="https://cdn.example/talk_64kb.mp3">');
      }
      return audio();
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAudioFromUrl("https://archive.example/details/talk");
    expect(result.finalUrl).toBe("https://cdn.example/talk_64kb.mp3");
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("sends the page as Referer and identifies itself, as hotlink-protected hosts expect", async () => {
    publicDns();
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
      seen.push({ url: String(input), ...(init?.headers as Record<string, string>) });
      return String(input).endsWith("/page") ? html('<audio src="/a.mp3"></audio>') : audio();
    }));

    await fetchAudioFromUrl("https://host.example/page");
    expect(seen[1].Referer).toBe("https://host.example/page");
    expect(seen[0]["User-Agent"]).toMatch(/StudyScribe/);
  });

  it("falls through to the next candidate when the first can't be downloaded", async () => {
    publicDns();
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/page")) return html('<a href="/broken.mp3">a</a><a href="/works.mp3">b</a>');
      if (url.endsWith("/broken.mp3")) return new Response("gone", { status: 404 });
      return audio();
    }));

    const result = await fetchAudioFromUrl("https://host.example/page");
    expect(result.finalUrl).toBe("https://host.example/works.mp3");
  });

  it("explains a page that has no downloadable media", async () => {
    publicDns();
    vi.stubGlobal("fetch", vi.fn(async () => html("<html><body>Watch on the site</body></html>")));
    await expect(fetchAudioFromUrl("https://host.example/watch")).rejects.toThrow(/not an audio file.*no downloadable/i);
  });

  it("explains a page whose only video is an HLS/DASH stream", async () => {
    publicDns();
    vi.stubGlobal("fetch", vi.fn(async () => html('<video src="https://cdn.example/master.m3u8"></video>')));
    await expect(fetchAudioFromUrl("https://host.example/watch")).rejects.toThrow(/HLS\/DASH/);
  });

  it("does not follow a page that links to another page", async () => {
    publicDns();
    const fetchMock = vi.fn(async (input: unknown) =>
      String(input).endsWith("/page") ? html('<a href="/next.mp3">x</a>') : html("<html>another page</html>"),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAudioFromUrl("https://host.example/page")).rejects.toThrow(/couldn't download it/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still blocks a page whose media link points at a private address", async () => {
    // The page is public, but the media URL it names resolves to loopback:
    // the same SSRF check that guards the pasted link must guard this one.
    lookup.mockImplementation(async (host: string) =>
      host === "internal.example"
        ? [{ address: "127.0.0.1", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }],
    );
    vi.stubGlobal("fetch", vi.fn(async () => html('<audio src="http://internal.example/secret.mp3"></audio>')));
    await expect(fetchAudioFromUrl("https://host.example/page")).rejects.toThrow(/private address/i);
  });

  it("caps how much of a page it will read", async () => {
    publicDns();
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode("<p>filler</p>".repeat(1000)));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(endless, { status: 200, headers: { "content-type": "text/html" } }),
    ));
    await expect(fetchAudioFromUrl("https://host.example/huge")).rejects.toThrow(/no downloadable/i);
    expect(pulled).toBeLessThan(400);
  });
});

describe("content types servers use for the same audio", () => {
  it("treats application/ogg (what Wikimedia serves for .ogg) as audio/ogg", async () => {
    publicDns();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("ogg", { status: 200, headers: { "content-type": "application/ogg" } }),
    ));
    const result = await fetchAudioFromUrl("https://upload.example/speech.ogg");
    expect(result.mimeType).toBe("audio/ogg");
    // Whatever the import step hands storage must actually be storable.
    expect(normalizeAudioMimeType(result.mimeType)).toBe("audio/ogg");
  });

  it("falls back to the file extension when the declared type is one we don't recognise", async () => {
    publicDns();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("mp3", { status: 200, headers: { "content-type": "audio/x-strange-thing" } }),
    ));
    const result = await fetchAudioFromUrl("https://example.com/talk.mp3");
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("normalises common alternate MP3 and WAV labels", async () => {
    publicDns();
    for (const [declared, expected] of [["audio/x-mp3", "audio/mpeg"], ["audio/mpeg3", "audio/mpeg"], ["audio/vnd.wave", "audio/wav"]]) {
      vi.stubGlobal("fetch", vi.fn(async () =>
        new Response("x", { status: 200, headers: { "content-type": declared } }),
      ));
      const result = await fetchAudioFromUrl("https://example.com/file");
      expect(result.mimeType, declared).toBe(expected);
    }
  });
});

describe("other video and audio containers", () => {
  it("maps extensions for containers beyond mp3/mp4", () => {
    const expectations: Record<string, string> = {
      "https://x.example/a.opus": "audio/ogg",
      "https://x.example/a.ogv": "video/ogg",
      "https://x.example/a.mkv": "video/x-matroska",
      "https://x.example/a.avi": "video/x-msvideo",
      "https://x.example/a.mpg": "video/mpeg",
      "https://x.example/a.3gp": "video/3gpp",
      "https://x.example/a.wma": "audio/x-ms-wma",
      "https://x.example/a.aiff": "audio/aiff",
      "https://x.example/a.flac": "audio/flac",
    };
    for (const [url, type] of Object.entries(expectations)) {
      expect(guessMimeTypeFromUrl(url), url).toBe(type);
    }
  });

  it("stores every importable container type instead of failing at the storage step", () => {
    // fetchAudioFromUrl accepting a type is worthless if storage then throws
    // "Unsupported audio format" — that was the case for .flac before.
    for (const type of ["audio/flac", "audio/ogg", "video/ogg", "audio/opus", "video/x-matroska", "video/x-msvideo", "video/mpeg", "video/3gpp", "audio/x-ms-wma", "audio/aiff"]) {
      const normalized = normalizeAudioMimeType(type);
      expect(["audio/flac", "audio/ogg", "video/x-matroska", "video/x-msvideo", "video/mpeg", "video/3gpp", "audio/x-ms-wma", "audio/aiff"], type).toContain(normalized);
    }
    expect(normalizeAudioMimeType("video/ogg")).toBe("audio/ogg");
    expect(normalizeAudioMimeType("audio/opus")).toBe("audio/ogg");
  });

  it("accepts an MKV link", async () => {
    publicDns();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("video", { status: 200, headers: { "content-type": "video/x-matroska" } }),
    ));
    const result = await fetchAudioFromUrl("https://example.com/panel.mkv");
    expect(result.mimeType).toBe("video/x-matroska");
  });
});

describe("limitStreamSize", () => {
  it("passes through a stream under the cap", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array(10)); c.close(); },
    });
    await expect(drain(limitStreamSize(source, 100))).resolves.toBe(10);
  });

  it("aborts a download that exceeds the cap even if Content-Length lied", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array(60)); c.enqueue(new Uint8Array(60)); c.close(); },
    });
    await expect(drain(limitStreamSize(source, 100))).rejects.toThrow(/larger than/i);
  });
});

describe("fetchAudioFromUrl", () => {
  it("validates each redirect hop, blocking a public host that redirects to metadata", async () => {
    lookup.mockImplementation(async (host: string) =>
      host === "start.example" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }],
    );
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    ));
    await expect(fetchAudioFromUrl("https://start.example/a.mp3")).rejects.toThrow(/private address/i);
  });

  it("refuses a link that is plainly not audio", async () => {
    publicDns();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } }),
    ));
    await expect(fetchAudioFromUrl("https://example.com/page")).rejects.toThrow(/not an audio file/i);
  });

  it("surfaces an upstream error status", async () => {
    publicDns();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(fetchAudioFromUrl("https://example.com/a.mp3")).rejects.toThrow(/404/);
  });

  it("rejects a file whose declared length exceeds the cap before downloading it", async () => {
    publicDns();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("x", {
        status: 200,
        headers: { "content-type": "audio/mpeg", "content-length": String(900 * 1024 * 1024) },
      }),
    ));
    await expect(fetchAudioFromUrl("https://example.com/huge.mp3")).rejects.toThrow(/larger than/i);
  });

  it("accepts audio and prefers the URL extension over a generic server content type", async () => {
    publicDns();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("audio", { status: 200, headers: { "content-type": "application/octet-stream" } }),
    ));
    const result = await fetchAudioFromUrl("https://example.com/lecture.m4a");
    expect(result.mimeType).toBe("audio/mp4");
  });

  it("follows a valid redirect to a public host and returns the final audio", async () => {
    publicDns();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://cdn.example/final.mp3" } }))
      .mockResolvedValueOnce(new Response("audio", { status: 200, headers: { "content-type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAudioFromUrl("https://example.com/talk.mp3");
    expect(result.finalUrl).toBe("https://cdn.example/final.mp3");
    expect(result.mimeType).toBe("audio/mpeg");
  });
});

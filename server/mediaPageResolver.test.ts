import { describe, expect, it } from "vitest";
import { extractMediaCandidates, readTextLimited } from "./mediaPageResolver";

const PAGE = "https://archive.org/details/some_talk";

describe("extractMediaCandidates", () => {
  it("prefers the page's own Open Graph media statement", () => {
    const html = `
      <meta property="og:video" content="https://archive.org/download/some_talk/talk_64kb.mp3">
      <a href="/download/some_talk/talk.ogg">ogg</a>`;
    const { candidates } = extractMediaCandidates(html, PAGE);
    expect(candidates[0]).toBe("https://archive.org/download/some_talk/talk_64kb.mp3");
    expect(candidates).toContain("https://archive.org/download/some_talk/talk.ogg");
  });

  it("reads <source> elements, decoding entities and resolving relative URLs", () => {
    const html = `<audio controls>
      <source src="/media/lecture.opus?utm_source=x&amp;utm_campaign=y" type="audio/ogg; codecs=&quot;opus&quot;">
      <source src="lecture.mp3" type="audio/mpeg">
    </audio>`;
    const { candidates } = extractMediaCandidates(html, "https://school.example/courses/intro/");
    expect(candidates).toEqual([
      "https://school.example/media/lecture.opus?utm_source=x&utm_campaign=y",
      "https://school.example/courses/intro/lecture.mp3",
    ]);
  });

  it("accepts a source with a media type even without a recognizable extension", () => {
    const html = `<video><source src="/stream/12345" type="video/mp4"></video>`;
    expect(extractMediaCandidates(html, "https://school.example/v").candidates).toEqual([
      "https://school.example/stream/12345",
    ]);
  });

  it("ignores a player page declared as text/html or flash", () => {
    const html = `
      <meta property="og:video" content="https://player.example/embed/1">
      <meta property="og:video:type" content="text/html">
      <video><source src="https://player.example/embed/2" type="text/html"></video>`;
    expect(extractMediaCandidates(html, PAGE).candidates).toEqual([]);
  });

  it("finds structured-data contentUrl", () => {
    const html = `<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https:\\/\\/cdn.example\\/talks\\/keynote.mp4"}</script>`;
    expect(extractMediaCandidates(html, PAGE).candidates).toEqual(["https://cdn.example/talks/keynote.mp4"]);
  });

  it("finds plain download links and de-duplicates repeats", () => {
    const html = `<a href="a.mp3">one</a><a href="a.mp3">again</a><a href="notes.pdf">notes</a>`;
    expect(extractMediaCandidates(html, "https://x.example/p/").candidates).toEqual(["https://x.example/p/a.mp3"]);
  });

  it("never returns non-http schemes", () => {
    const html = `<audio src="data:audio/mp3;base64,AAAA"></audio><a href="javascript:void(0)">x</a><a href="file:///etc/x.mp3">y</a>`;
    expect(extractMediaCandidates(html, PAGE).candidates).toEqual([]);
  });

  it("flags streaming manifests instead of returning them as files", () => {
    const html = `<video src="https://cdn.example/live/master.m3u8"></video>`;
    const scan = extractMediaCandidates(html, PAGE);
    expect(scan.candidates).toEqual([]);
    expect(scan.hasStreamingManifest).toBe(true);
  });

  it("caps how many candidates it hands back", () => {
    const html = Array.from({ length: 30 }, (_, i) => `<a href="/f${i}.mp3">${i}</a>`).join("");
    expect(extractMediaCandidates(html, PAGE).candidates.length).toBeLessThanOrEqual(5);
  });

  it("returns nothing for a page with no media at all", () => {
    expect(extractMediaCandidates("<html><body><p>hello</p></body></html>", PAGE)).toEqual({
      candidates: [],
      hasStreamingManifest: false,
    });
  });
});

describe("readTextLimited", () => {
  it("stops reading once the byte budget is spent", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1000));
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const text = await readTextLimited(stream, 3000);
    expect(text.length).toBeGreaterThanOrEqual(3000);
    expect(text.length).toBeLessThan(5000);
    expect(pulled).toBeLessThan(10);
  });
});

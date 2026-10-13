import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capPerRecording,
  chunkTranscript,
  cosineSimilarity,
  decodeVector,
  embedTexts,
  encodeVector,
  fuseRankings,
  getEmbeddingConfig,
  rankBySimilarity,
  transcriptContentHash,
} from "./embeddings";
import type { Passage } from "./askRetrieval";

afterEach(() => vi.unstubAllGlobals());

describe("embedding config", () => {
  it("is off without a model, and reuses the OpenAI key and base URL", () => {
    expect(getEmbeddingConfig({ OPENAI_API_KEY: "k" } as any)).toBeNull();
    expect(getEmbeddingConfig({ OPENAI_EMBEDDING_MODEL: "m" } as any)).toBeNull();
    expect(getEmbeddingConfig({ OPENAI_EMBEDDING_MODEL: "text-embedding-3-small", OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://llm.example/v1/" } as any)).toEqual({
      baseUrl: "https://llm.example/v1",
      apiKey: "k",
      model: "text-embedding-3-small",
      dimensions: undefined,
    });
    expect(getEmbeddingConfig({ OPENAI_EMBEDDING_MODEL: "m", OPENAI_EMBEDDING_API_KEY: "e", OPENAI_API_KEY: "k", OPENAI_EMBEDDING_DIMENSIONS: "512" } as any)).toMatchObject({ apiKey: "e", dimensions: 512 });
  });
});

describe("vectors", () => {
  it("round-trips float32 through bytes", () => {
    const decoded = decodeVector(encodeVector([0.5, -1.25, 3]));
    expect(Array.from(decoded)).toEqual([0.5, -1.25, 3]);
  });

  it("decodes from an unaligned buffer slice", () => {
    const bytes = Buffer.concat([Buffer.from([7]), encodeVector([1, 2])]).subarray(1);
    expect(Array.from(decodeVector(bytes))).toEqual([1, 2]);
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("chunking", () => {
  const source = {
    recordingId: 1,
    title: "Biology",
    fullText: "a".repeat(10),
    segments: Array.from({ length: 20 }, (_, i) => ({ start: i * 10, end: i * 10 + 9, text: `Sentence number ${i} about cells and energy.` })),
  };
  source.fullText = source.segments.map(segment => segment.text).join(" ");

  it("groups timed segments into passages that keep their start time", () => {
    const chunks = chunkTranscript(source, 200);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]).toMatchObject({ chunkIndex: 0, start: 0 });
    expect(chunks[1].start).toBeGreaterThan(0);
    expect(chunks.map(chunk => chunk.text).join(" ")).toBe(source.fullText);
  });

  it("hashes the content so edits are noticed", () => {
    const before = transcriptContentHash(source);
    expect(transcriptContentHash({ ...source })).toBe(before);
    expect(transcriptContentHash({ ...source, fullText: `${source.fullText}!` })).not.toBe(before);
  });
});

describe("ranking", () => {
  it("ranks candidates by similarity and drops weak matches", () => {
    const ranked = rankBySimilarity(
      [1, 0, 0],
      [
        { recordingId: 1, title: "A", start: 0, text: "near", vector: [0.9, 0.1, 0] },
        { recordingId: 2, title: "B", start: 5, text: "far", vector: [0, 0, 1] },
        { recordingId: 3, title: "C", start: 9, text: "nearest", vector: [1, 0, 0] },
      ],
      5,
    );
    expect(ranked.map(item => item.text)).toEqual(["nearest", "near"]);
  });

  const p = (recordingId: number, start: number, text: string): Passage => ({ recordingId, title: `R${recordingId}`, start, text });

  it("fuses keyword and semantic rankings, lifting passages both found", () => {
    const keyword = [p(1, 0, "alpha"), p(2, 10, "beta"), p(3, 20, "gamma")];
    const semantic = [p(4, 0, "delta"), p(2, 10.4, "beta"), p(5, 0, "epsilon")];
    const fused = fuseRankings(keyword, semantic, { limit: 4, perRecording: 2 });
    expect(fused[0].text).toBe("beta");
    expect(fused).toHaveLength(4);
    expect(new Set(fused.map(item => item.text)).size).toBe(4);
  });

  it("caps passages per recording", () => {
    const keyword = [p(1, 0, "one"), p(1, 10, "two"), p(1, 20, "three")];
    expect(fuseRankings(keyword, [], { limit: 10, perRecording: 2 })).toHaveLength(2);
  });
});

describe("embedTexts", () => {
  it("calls the OpenAI-compatible endpoint and keeps the input order", async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.model).toBe("m");
      expect(body.dimensions).toBe(3);
      return new Response(JSON.stringify({ data: body.input.map((_: string, index: number) => ({ index, embedding: [index, 0, 0] })).reverse() }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const vectors = await embedTexts(["a", "b"], { config: { baseUrl: "https://x/v1", apiKey: "k", model: "m", dimensions: 3 } });
    expect(vectors).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://x/v1/embeddings");
  });

  it("explains a provider error", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad key", { status: 401 }));
    await expect(embedTexts(["a"], { config: { baseUrl: "https://x/v1", apiKey: "k", model: "m" } })).rejects.toThrow(/401/);
  });
});

describe("capPerRecording", () => {
  it("keeps the best two from each recording, in rank order, up to the limit", () => {
    const ranked = [1, 1, 2, 1, 3, 2, 2, 4].map((recordingId, index) => ({ recordingId, index }));
    expect(capPerRecording(ranked, 2, 10).map(item => item.index)).toEqual([0, 1, 2, 4, 5, 7]);
    expect(capPerRecording(ranked, 2, 3).map(item => item.index)).toEqual([0, 1, 2]);
  });
});

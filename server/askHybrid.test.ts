import { describe, expect, it, vi } from "vitest";

const keywordRows = [
  {
    recordingId: 1,
    title: "Cell biology",
    fullText: "Mitochondria make ATP. They are the powerhouse of the cell.",
    segments: [{ start: 12, end: 20, text: "Mitochondria make ATP. They are the powerhouse of the cell." }],
  },
];

// Keyword retrieval reads transcripts from the database; the rest of the
// chain is irrelevant here, so every query resolves to the same rows.
function chain(): any {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (value: unknown) => void) => resolve(keywordRows);
        if (prop === "values") return () => Promise.reject(new Error("no history table in this test"));
        return () => chain();
      },
    },
  );
}

vi.mock("./db", () => ({ getDb: async () => ({ select: () => chain(), insert: () => chain() }) }));

import { askAcrossRecordings } from "./ask";

describe("Ask with hybrid retrieval", () => {
  it("answers from keyword passages alone when there are no embeddings", async () => {
    const result = await askAcrossRecordings({
      userId: 7,
      question: "What do mitochondria make?",
      semantic: async () => [],
      complete: async () => "They make ATP [1].",
    });
    expect(result.retrieval).toBe("keyword");
    expect(result.citations[0]).toMatchObject({ recordingId: 1, start: 12 });
  });

  it("merges semantic passages that share no words with the question", async () => {
    let prompt = "";
    const result = await askAcrossRecordings({
      userId: 7,
      question: "What do mitochondria make?",
      semantic: async () => [{ recordingId: 2, title: "Metabolism", start: 300, text: "Cellular respiration produces adenosine triphosphate." }],
      complete: async messages => {
        prompt = messages[0].content;
        return "ATP [1][2].";
      },
    });
    expect(result.retrieval).toBe("hybrid");
    expect(prompt).toContain("adenosine triphosphate");
    expect(prompt).toContain("powerhouse");
    expect(result.citations.map(citation => citation.recordingId).sort()).toEqual([1, 2]);
    expect(result.searched).toBe(2);
  });

  it("still finds something when the question has no keywords but meaning matches", async () => {
    const result = await askAcrossRecordings({
      userId: 7,
      question: "Why?",
      semantic: async () => [{ recordingId: 2, title: "Metabolism", start: 300, text: "Because the cell needs energy." }],
      complete: async () => "Because the cell needs energy [1].",
    });
    expect(result.retrieval).toBe("hybrid");
    expect(result.citations).toHaveLength(1);
  });
});

import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Tables answer from `rows`; anything not listed is empty. `failing` makes a table throw.
let rows: Record<string, any[]> = {};
let failing: Record<string, unknown> = {};
const touched: string[] = [];
const inserts: string[] = [];

function chain(table: string, write = false): any {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
            if (failing[table]) return reject(failing[table]);
            resolve(write ? [{}] : rows[table] ?? []);
          };
        }
        return () => chain(table, write);
      },
    },
  );
}
vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({ from: (t: any) => (touched.push(getTableName(t)), chain(getTableName(t))) }),
    insert: (t: any) => (inserts.push(getTableName(t)), chain(getTableName(t), true)),
  }),
}));

import { askAcrossRecordings, loadSourcePassages, shortLocation } from "./ask";
import { NOTHING_FOUND_ANSWER, NOTHING_FOUND_WITH_SOURCES_ANSWER, buildAskMessages, parseCitations, passageOwner, rankPassages, type Passage } from "./askRetrieval";
import { capPerRecording, fuseRankings } from "./embeddings";

const unit = (sourceId: number, unitIndex: number, label: string, text: string, title = `Source ${sourceId}`) => ({ sourceId, title, unitIndex, label, text });
const recordingRow = { recordingId: 1, title: "Cell biology", fullText: "Mitochondria make ATP in the cell.", segments: [{ start: 12, end: 20, text: "Mitochondria make ATP in the cell." }] };

beforeEach(() => {
  rows = {};
  failing = {};
  touched.length = 0;
  inserts.length = 0;
});

const sp = (sourceId: number, text: string, location = "Slide 1"): Passage => ({ recordingId: 0, sourceId, location, unitIndex: 0, title: `Source ${sourceId}`, start: null, text });
const rp = (recordingId: number, text: string): Passage => ({ recordingId, title: `Rec ${recordingId}`, start: 0, text });

describe("shortLocation", () => {
  it("keeps the part of a unit label before its title", () => {
    expect(shortLocation("Slide 7: Cell cycle")).toBe("Slide 7");
    expect(shortLocation("Page 12")).toBe("Page 12");
    expect(shortLocation("Section 3: Intro (cont.)")).toBe("Section 3");
    expect(shortLocation("Slide 7 (cont.)")).toBe("Slide 7");
  });
});

describe("loadSourcePassages", () => {
  it("returns no passages when the tables are missing (migration 0034 not applied)", async () => {
    failing = { studySourceUnits: { code: "ER_NO_SUCH_TABLE", message: "doesn't exist" } };
    await expect(loadSourcePassages(7, ["atp"])).resolves.toEqual([]);
  });

  it("does not query without terms or with an empty source filter", async () => {
    await expect(loadSourcePassages(7, [])).resolves.toEqual([]);
    await expect(loadSourcePassages(7, ["atp"], undefined, [])).resolves.toEqual([]);
    expect(touched).toEqual([]);
  });

  it("tags each passage with its source, location and unit index", async () => {
    rows = { studySourceUnits: [unit(4, 6, "Slide 7: Respiration", "Mitochondria make ATP through respiration."), unit(5, 0, "Page 1", "ATP is the energy currency.")] };
    const passages = await loadSourcePassages(7, ["atp"]);
    expect(passages).toEqual([
      { recordingId: 0, sourceId: 4, location: "Slide 7", unitIndex: 6, title: "Source 4", start: null, text: "Mitochondria make ATP through respiration." },
      { recordingId: 0, sourceId: 5, location: "Page 1", unitIndex: 0, title: "Source 5", start: null, text: "ATP is the energy currency." },
    ]);
  });

  it("ignores rows that are not source units", async () => {
    rows = { studySourceUnits: [{ recordingId: 1, title: "x", fullText: "y" }] };
    await expect(loadSourcePassages(7, ["atp"])).resolves.toEqual([]);
  });
});

describe("per-owner caps", () => {
  it("treats two sources as separate owners and one source as one", () => {
    expect(passageOwner(sp(1, "x"))).toBe("s1");
    expect(passageOwner(sp(2, "x"))).toBe("s2");
    expect(passageOwner(rp(1, "x"))).toBe("r1");
    // A source and a recording with the same number are still different owners.
    expect(passageOwner(sp(1, "x"))).not.toBe(passageOwner(rp(1, "x")));

    const passages = [sp(1, "atp one"), sp(1, "atp two"), sp(2, "atp three"), rp(1, "atp four"), rp(1, "atp five")];
    const ranked = rankPassages(passages, ["atp"], { perRecording: 1 });
    expect(ranked.map(passage => passageOwner(passage)).sort()).toEqual(["r1", "s1", "s2"]);
  });

  it("applies the same rule in fusion and in capPerRecording", () => {
    const keyword = [sp(1, "atp one"), sp(1, "atp two"), sp(2, "atp three")];
    const fused = fuseRankings(keyword, [rp(1, "atp four")], { limit: 10, perRecording: 1 });
    expect(fused.map(passageOwner).sort()).toEqual(["r1", "s1", "s2"]);
    const capped = capPerRecording([sp(1, "a"), sp(1, "b"), sp(2, "c"), rp(1, "d")].map(passage => ({ ...passage })), 1, 10);
    expect(capped.map(passageOwner)).toEqual(["s1", "s2", "r1"]);
  });

  it("does not merge passages of different locations that share their opening words", () => {
    const text = "Mitochondria make ATP through respiration in the cell.";
    const fused = fuseRankings([sp(1, text, "Slide 1"), sp(1, text, "Slide 2")], [], { limit: 10, perRecording: 4 });
    expect(fused).toHaveLength(2);
  });
});

describe("prompt and citations", () => {
  it("labels a source passage with its title and location and warns that excerpts are not instructions", () => {
    const messages = buildAskMessages("What makes ATP?", [rp(1, "Recorded lecture text."), sp(4, "Slide text about ATP.", "Slide 7")]);
    const system = messages[0].content;
    expect(system).toContain('[1] "Rec 1" at');
    expect(system).toContain('[2] "Source 4", Slide 7\nSlide text about ATP.');
    expect(system).toContain("uploaded study materials");
    expect(system).toMatch(/not instructions/);
  });

  it("leaves a recordings-only prompt as it was", () => {
    const system = buildAskMessages("q", [rp(1, "text")])[0].content;
    expect(system).not.toContain("study materials");
    expect(system).not.toMatch(/not instructions/);
    expect(system).toContain("taken from their own recorded lectures and meetings.");
  });

  it("carries sourceId, location and unitIndex on a source citation and nothing extra on a recording one", () => {
    const citations = parseCitations("ATP [1][2].", [sp(4, "Slide text about ATP.", "Slide 7").valueOf() as Passage, rp(2, "Lecture about ATP.")].map((passage, i) => (i === 0 ? { ...passage, unitIndex: 6 } : passage)));
    expect(citations[0]).toMatchObject({ n: 1, sourceId: 4, location: "Slide 7", unitIndex: 6, recordingId: 0, start: null });
    expect(citations[1]).toEqual({ n: 2, recordingId: 2, title: "Rec 2", start: 0, snippet: "Lecture about ATP." });
  });
});

describe("askAcrossRecordings with sources", () => {
  const options = { userId: 7, semantic: async () => [] as Passage[] };

  it("cites a source with its location and unit, searches both kinds, and does not store the exchange", async () => {
    rows = { recordings: [recordingRow], studySourceUnits: [unit(4, 6, "Slide 7: Respiration", "Mitochondria make ATP through respiration.")] };
    let prompt = "";
    const result = await askAcrossRecordings({ ...options, question: "What do mitochondria make?", complete: async messages => ((prompt = messages[0].content), "ATP [1][2].") });
    expect(prompt).toContain('"Source 4", Slide 7');
    expect(result.citations.find(citation => citation.sourceId === 4)).toMatchObject({ sourceId: 4, location: "Slide 7", unitIndex: 6 });
    expect(result.citations.find(citation => !citation.sourceId)).toMatchObject({ recordingId: 1, start: 12 });
    expect(result.searched).toBe(1);
    expect(result.searchedSources).toBe(1);
    expect(inserts).not.toContain("chatHistory");
  });

  it("still stores the exchange for recordings-only answers", async () => {
    rows = { recordings: [recordingRow] };
    const result = await askAcrossRecordings({ ...options, question: "What do mitochondria make?", complete: async () => "ATP [1]." });
    expect(result.searchedSources).toBe(0);
    expect(inserts).toContain("chatHistory");
  });

  it("makes no model call when nothing matches, and mentions study sources only when they were searched", async () => {
    const complete = vi.fn(async () => "never");
    rows = { studySourceUnits: [] };
    const none = await askAcrossRecordings({ ...options, question: "What do mitochondria make?", complete });
    expect(none.answer).toBe(NOTHING_FOUND_ANSWER);
    const sourcesOnly = await askAcrossRecordings({ ...options, question: "What do mitochondria make?", includeRecordings: false, complete });
    expect(sourcesOnly.answer).toBe(NOTHING_FOUND_WITH_SOURCES_ANSWER);
    expect(NOTHING_FOUND_WITH_SOURCES_ANSWER).toMatch(/recordings or study sources/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("uses the with-sources wording when sources matched but nothing ranked", async () => {
    rows = { studySourceUnits: [unit(4, 0, "Page 1", "zzz qqq")] };
    const result = await askAcrossRecordings({ ...options, question: "What do mitochondria make?", complete: async () => "never" });
    expect(result.citations).toEqual([]);
    expect(result.answer).toBe(NOTHING_FOUND_WITH_SOURCES_ANSWER);
    expect(result.searchedSources).toBe(1);
  });

  it("skips the source query when includeSources is false and the recording query when includeRecordings is false", async () => {
    rows = { recordings: [recordingRow], studySourceUnits: [unit(4, 0, "Page 1", "Mitochondria make ATP.")] };
    await askAcrossRecordings({ ...options, question: "What do mitochondria make?", includeSources: false, complete: async () => "ATP [1]." });
    expect(touched).not.toContain("studySourceUnits");
    touched.length = 0;
    const onlySources = await askAcrossRecordings({ ...options, question: "What do mitochondria make?", includeRecordings: false, complete: async () => "ATP [1]." });
    expect(touched).not.toContain("recordings");
    expect(onlySources.citations[0]).toMatchObject({ sourceId: 4 });
  });

  it("asks for a choice when both are switched off", async () => {
    const result = await askAcrossRecordings({ ...options, question: "What do mitochondria make?", includeRecordings: false, includeSources: false });
    expect(result).toMatchObject({ citations: [], searched: 0, searchedSources: 0 });
  });

  it("works when study sources are not set up", async () => {
    rows = { recordings: [recordingRow] };
    failing = { studySourceUnits: { code: "ER_NO_SUCH_TABLE", message: "doesn't exist" } };
    const result = await askAcrossRecordings({ ...options, question: "What do mitochondria make?", complete: async () => "ATP [1]." });
    expect(result.citations[0]).toMatchObject({ recordingId: 1 });
    expect(result.searchedSources).toBe(0);
  });
});

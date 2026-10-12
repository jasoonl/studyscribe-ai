import { describe, expect, it } from "vitest";
import {
  buildAskMessages,
  buildPassages,
  escapeLike,
  extractSearchTerms,
  formatTimestamp,
  parseCitations,
  rankPassages,
  stem,
  type AskSource,
  type Passage,
} from "./askRetrieval";

const passage = (recordingId: number, text: string, start: number | null = 0, title = `Lecture ${recordingId}`): Passage => ({
  recordingId,
  title,
  start,
  text,
});

describe("extractSearchTerms", () => {
  it("drops filler words and keeps the topic", () => {
    expect(extractSearchTerms("What did the professor say about mitosis across all lectures?")).toEqual(["mitosi"]);
  });

  it("reduces plurals and possessives to one root and removes duplicates", () => {
    expect(extractSearchTerms("Enzymes, enzyme and the enzyme's role")).toEqual(["enzyme", "role"]);
  });

  it("keeps non-English words intact", () => {
    expect(extractSearchTerms("¿Qué es la fotosíntesis?")).toContain("fotosíntesi");
  });

  it("caps the number of terms, preferring the longer ones", () => {
    const terms = extractSearchTerms("alpha1 beta22 gamma333 delta4444 epsilon55555 zeta666666 eta7777777 theta88888888 iota999999999 kappa");
    expect(terms).toHaveLength(8);
    expect(terms).not.toContain("kappa");
    expect(terms).not.toContain("beta22");
  });

  it("returns nothing for a question made only of filler", () => {
    expect(extractSearchTerms("What did you say about it?")).toEqual([]);
  });
});

describe("stem", () => {
  it("trims common suffixes but leaves short words alone", () => {
    expect(stem("studies")).toBe("study");
    expect(stem("running")).toBe("runn");
    expect(stem("glass")).toBe("glass");
    expect(stem("bus")).toBe("bus");
  });
});

describe("escapeLike", () => {
  it("escapes wildcards so they match literally", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("buildPassages", () => {
  const segments = Array.from({ length: 12 }, (_, index) => ({
    start: index * 10,
    end: index * 10 + 9,
    text: `Sentence number ${index} talks about topic ${index} in some detail for the class.`,
  }));
  const fullText = segments.map(segment => segment.text).join(" ");

  it("groups consecutive segments and keeps the first start time", () => {
    const passages = buildPassages({ recordingId: 1, title: "Bio", fullText, segments }, 200);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages[0].start).toBe(0);
    expect(passages[1].start).toBeGreaterThan(0);
    expect(passages.every(item => item.recordingId === 1 && item.title === "Bio")).toBe(true);
  });

  it("falls back to sentences without timestamps when there are no segments", () => {
    const passages = buildPassages({ recordingId: 2, title: "Notes", fullText, segments: null }, 200);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every(item => item.start === null)).toBe(true);
  });

  it("ignores stale segments when the transcript was edited far away from them", () => {
    const source: AskSource = { recordingId: 3, title: "Edited", fullText: `${fullText} ${fullText} ${fullText}`, segments };
    expect(buildPassages(source, 400).every(item => item.start === null)).toBe(true);
  });

  it("returns nothing for an empty transcript", () => {
    expect(buildPassages({ recordingId: 4, title: "Empty", fullText: "", segments: [] })).toEqual([]);
  });
});

describe("rankPassages", () => {
  const passages = [
    passage(1, "Today we cover the cell cycle. Mitosis has four phases: prophase, metaphase, anaphase and telophase."),
    passage(1, "The weather was awful so we started late."),
    passage(2, "Meiosis differs from mitosis because it produces four genetically distinct cells."),
    passage(3, "Budget review: marketing spend is up."),
  ];

  it("puts passages that match the question first and drops unrelated ones", () => {
    const ranked = rankPassages(passages, ["mitosi"]);
    expect(ranked.map(item => item.recordingId)).toEqual([1, 2]);
  });

  it("prefers a passage that covers more of the question's terms", () => {
    const ranked = rankPassages(passages, ["mitosi", "meiosi"]);
    expect(ranked[0].recordingId).toBe(2);
  });

  it("matches at the start of words, so a short term does not hit the middle of another word", () => {
    const short = [passage(1, "She said the maid paid for it."), passage(2, "AI tutors answer questions. Artificial intelligence (AI) is broad.")];
    expect(rankPassages(short, ["ai"]).map(item => item.recordingId)).toEqual([2]);
    expect(rankPassages(short, ["tutor"]).map(item => item.recordingId)).toEqual([2]);
  });

  it("caps passages per recording so one lecture cannot crowd out the rest", () => {
    const many = [
      ...Array.from({ length: 10 }, (_, index) => passage(1, `mitosis detail ${index}`)),
      passage(2, "mitosis in another course"),
    ];
    const ranked = rankPassages(many, ["mitosi"], { limit: 12, perRecording: 3 });
    expect(ranked.filter(item => item.recordingId === 1)).toHaveLength(3);
    expect(ranked.some(item => item.recordingId === 2)).toBe(true);
  });

  it("respects the overall limit and handles empty input", () => {
    expect(rankPassages(passages, ["mitosi"], { limit: 1 })).toHaveLength(1);
    expect(rankPassages([], ["mitosi"])).toEqual([]);
    expect(rankPassages(passages, [])).toEqual([]);
  });
});

describe("formatTimestamp", () => {
  it("formats minutes and hours, and blanks unknown times", () => {
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(formatTimestamp(null)).toBe("");
    expect(formatTimestamp(Number.NaN)).toBe("");
  });
});

describe("buildAskMessages", () => {
  const passages = [passage(1, "Mitosis has four phases.", 754, "Biology 101"), passage(2, "No timestamp here.", null, "Chem")];

  it("numbers the excerpts with titles and times and ends with the question", () => {
    const messages = buildAskMessages("How many phases?", passages);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain('[1] "Biology 101" at 12:34');
    expect(messages[0].content).toContain('[2] "Chem"\nNo timestamp here.');
    expect(messages.at(-1)).toEqual({ role: "user", content: "How many phases?" });
  });

  it("keeps only the most recent history, between the system prompt and the question", () => {
    const history = Array.from({ length: 10 }, (_, index) => ({ role: (index % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${index}` }));
    const messages = buildAskMessages("next", passages, history);
    expect(messages).toHaveLength(1 + 6 + 1);
    expect(messages[1].content).toBe("m4");
  });
});

describe("parseCitations", () => {
  const passages = [passage(1, "one", 10, "A"), passage(2, "two", 20, "B"), passage(3, "x".repeat(300), 30, "C")];

  it("returns each cited passage once, in order of first mention", () => {
    const citations = parseCitations("Second [2] then first [1][2] and [3, 1].", passages);
    expect(citations.map(item => item.n)).toEqual([2, 1, 3]);
    expect(citations[0]).toMatchObject({ recordingId: 2, title: "B", start: 20 });
  });

  it("ignores numbers that are not excerpts and trims long snippets", () => {
    const citations = parseCitations("See [9] and [0] and [3].", passages);
    expect(citations.map(item => item.n)).toEqual([3]);
    expect(citations[0].snippet.length).toBeLessThanOrEqual(180);
    expect(citations[0].snippet.endsWith("...")).toBe(true);
  });

  it("returns nothing when the answer cites nothing", () => {
    expect(parseCitations("I could not find that.", passages)).toEqual([]);
  });
});

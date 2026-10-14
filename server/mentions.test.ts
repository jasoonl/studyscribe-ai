import { describe, expect, it } from "vitest";
import { MAX_MENTIONS_PER_COMMENT, activeMentionQuery, filterCandidates, mentionedIds, splitMentions } from "@shared/mentions";

const people = [
  { id: 1, name: "Ana" },
  { id: 2, name: "Ana Maria" },
  { id: 3, name: "Prof. Lee" },
  { id: 4, name: "Sam" },
];

describe("mentionedIds", () => {
  it("finds candidates mentioned by name, case-insensitively", () => {
    expect(mentionedIds("Thanks @prof. lee, and @Sam!", people)).toEqual([3, 4]);
  });

  it("does not match inside words, emails or longer names", () => {
    expect(mentionedIds("mail sam@Sam.com", people)).toEqual([]);
    expect(mentionedIds("@Samuel said", people)).toEqual([]);
    expect(mentionedIds("@Ana Maria agreed", people)).toEqual([1, 2]);
    expect(mentionedIds("@Anastasia", people)).toEqual([]);
  });

  it("ignores people who are not candidates and caps the count", () => {
    expect(mentionedIds("@Mallory look", people)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `P${i}` }));
    const body = many.map(p => `@${p.name}`).join(" ");
    expect(mentionedIds(body, many)).toHaveLength(MAX_MENTIONS_PER_COMMENT);
  });

  it("is empty without an @", () => {
    expect(mentionedIds("Ana Maria", people)).toEqual([]);
  });
});

describe("splitMentions", () => {
  it("marks the longest matching name", () => {
    expect(splitMentions("Hi @Ana Maria and @ana.", ["Ana", "Ana Maria"])).toEqual([
      { text: "Hi ", mention: false },
      { text: "@Ana Maria", mention: true },
      { text: " and ", mention: false },
      { text: "@ana", mention: true },
      { text: ".", mention: false },
    ]);
  });

  it("leaves emails alone", () => {
    expect(splitMentions("x@Ana", ["Ana"])).toEqual([{ text: "x@Ana", mention: false }]);
  });
});

describe("activeMentionQuery and filterCandidates", () => {
  it("reads the query being typed", () => {
    expect(activeMentionQuery("Hello @an", 9)).toEqual({ start: 6, query: "an" });
    expect(activeMentionQuery("mail a@b", 8)).toBeNull();
    expect(activeMentionQuery("no mention", 10)).toBeNull();
  });

  it("matches names and word starts", () => {
    expect(filterCandidates(people, "lee").map(p => p.id)).toEqual([3]);
    expect(filterCandidates(people, "an").map(p => p.id)).toEqual([1, 2]);
    expect(filterCandidates(people, "").length).toBe(4);
  });
});

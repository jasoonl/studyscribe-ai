import { beforeEach, describe, expect, it, vi } from "vitest";
import { courseVocabularies, recordingCourses, vocabularyLists } from "../drizzle/schema";

let tables: Map<unknown, Array<Record<string, unknown>> | "missing">;

function missing() {
  return Object.assign(new Error("Table 'x.courseVocabularies' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
}

vi.mock("./db", () => ({
  getRecordingById: vi.fn(),
  getDb: async () => ({
    select: () => ({
      from: (table: unknown) => {
        const rows = () => {
          const value = tables.get(table) ?? [];
          if (value === "missing") throw missing();
          return value;
        };
        const chain = {
          where: () => chain,
          limit: async () => rows(),
          then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
            try {
              return Promise.resolve(rows()).then(resolve, reject);
            } catch (error) {
              return Promise.reject(error).then(resolve, reject);
            }
          },
        };
        return chain;
      },
    }),
  }),
}));

const { resolveKeyterms } = await import("./vocabulary");

describe("course vocabulary in transcription keyterms", () => {
  beforeEach(() => {
    tables = new Map();
  });

  it("sends the recording's terms, then its course's, then the standing list", async () => {
    tables.set(vocabularyLists, [{ terms: "Standing term" }]);
    tables.set(recordingCourses, [{ courseId: 7 }]);
    tables.set(courseVocabularies, [{ terms: "Krebs cycle\nProf. Okafor" }]);
    expect(await resolveKeyterms(1, 10, ["Given term"])).toEqual(["Given term", "Krebs cycle", "Prof. Okafor", "Standing term"]);
  });

  it("skips the course list when the recording has no course", async () => {
    tables.set(vocabularyLists, [{ terms: "Standing term" }]);
    tables.set(courseVocabularies, [{ terms: "Should not appear" }]);
    expect(await resolveKeyterms(1, 10, [])).toEqual(["Standing term"]);
  });

  it("keeps working before the course table exists", async () => {
    tables.set(vocabularyLists, [{ terms: "Standing term" }]);
    tables.set(recordingCourses, [{ courseId: 7 }]);
    tables.set(courseVocabularies, "missing");
    expect(await resolveKeyterms(1, 10, ["Given"])).toEqual(["Given", "Standing term"]);
  });
});

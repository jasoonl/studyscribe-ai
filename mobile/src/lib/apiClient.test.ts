import { TRPCClientError } from "@trpc/client";
import { resolveApiUrl } from "./config";
import { appPathForWebPath } from "./links";
import { createTrpcClient, errorMessage, isUnauthorized } from "./trpc";
import { inlineRuns, parseMarkdown } from "@/components/Markdown";
import { activeSegmentIndex, findMatches, transcriptAsText } from "./transcript";
import { learnQueue, nextStatus } from "./flashcardDeck";

describe("tRPC client", () => {
  it("sends the bearer token and decodes superjson responses", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()) });
      // What the server's superjson sends for { id: 3, createdAt: Date }. Parsed in this realm on purpose:
      // superjson only walks plain objects, and Node's Response.json() builds them in another realm under Jest.
      const body = JSON.stringify([{ result: { data: { json: { id: 3, createdAt: "2026-10-13T10:00:00.000Z" }, meta: { values: { createdAt: ["Date"] } } } } }]);
      return { ok: true, status: 200, headers: new Headers({ "Content-Type": "application/json" }), json: async () => JSON.parse(body), text: async () => body };
    }) as unknown as typeof fetch;
    let token: string | null = "abc.def.ghi";
    const client = createTrpcClient(() => token, fetchImpl);
    const result = (await client.recordings.get.query({ id: 3 })) as unknown as { id: number; createdAt: Date };
    expect(seen[0].url).toContain("/api/trpc/recordings.get");
    expect(seen[0].headers.authorization).toBe("Bearer abc.def.ghi");
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt.getTime()).toBe(Date.UTC(2026, 9, 13, 10));

    token = null;
    await client.recordings.get.query({ id: 3 });
    expect(seen[1].headers.authorization).toBeUndefined();
  });

  it("recognises an expired session and explains errors", () => {
    const unauthorized = new TRPCClientError("Please login (10001)", { result: { error: { data: { code: "UNAUTHORIZED", httpStatus: 401 } } } as never });
    Object.assign(unauthorized, { data: { code: "UNAUTHORIZED", httpStatus: 401 } });
    expect(isUnauthorized(unauthorized)).toBe(true);
    expect(errorMessage(unauthorized)).toBe("Your session ended. Sign in again.");
    expect(errorMessage(new Error("Nope"))).toBe("Nope");
    expect(errorMessage("weird")).toBe("Something went wrong. Please try again.");
  });

  it("picks the API address", () => {
    expect(resolveApiUrl("https://api.example.com/", "ios", null)).toBe("https://api.example.com");
    expect(resolveApiUrl(undefined, "web", "http://localhost:8099")).toBe("http://localhost:8099");
    expect(resolveApiUrl("", "android", null)).toBe("https://studyscribe-ai.vercel.app");
  });
});

describe("links from notifications and the web", () => {
  it("maps web paths to app screens", () => {
    expect(appPathForWebPath("/recording/12")).toBe("/recording/12");
    expect(appPathForWebPath("https://studyscribe-ai.vercel.app/recording/12?t=95&utm=x")).toBe("/recording/12?t=95");
    expect(appPathForWebPath("/recordings/4/quizzes")).toBe("/recording/4/quiz");
    expect(appPathForWebPath("/invite?code=XYZ")).toBe("/signup?code=XYZ");
    expect(appPathForWebPath("/dashboard")).toBe("/");
    expect(appPathForWebPath("/admin")).toBe("/");
    expect(appPathForWebPath(null)).toBe("/");
  });
});

describe("transcript helpers", () => {
  const segments = [
    { start: 0, end: 4, text: "Welcome to biology.", speaker: "Speaker A" },
    { start: 5, end: 9, text: "Mitochondria make ATP.", speaker: "Speaker B" },
    { start: 10, end: 14, text: "More on mitochondria later.", speaker: "Speaker A" },
  ];
  it("finds matches case-insensitively", () => {
    expect(findMatches(segments, "MITOCHONDRIA")).toEqual([1, 2]);
    expect(findMatches(segments, "a")).toEqual([]);
  });
  it("follows playback", () => {
    expect(activeSegmentIndex(segments, 6)).toBe(1);
    expect(activeSegmentIndex(segments, 30)).toBe(-1);
  });
  it("exports with speakers, or the edited text when it differs", () => {
    const full = segments.map((segment) => segment.text).join(" ");
    expect(transcriptAsText("Bio", segments, full)).toContain("[0:05] Speaker B: Mitochondria make ATP.");
    expect(transcriptAsText("Bio", segments, "Edited text")).toBe("Bio\n\nEdited text");
  });
});

describe("markdown and flashcards", () => {
  it("parses the markdown the AI tools write", () => {
    expect(parseMarkdown("## Key Concepts\n- **ATP**: energy\n  - nested\n1. First\n\nPlain text\ncontinues")).toEqual([
      { kind: "heading", level: 2, text: "Key Concepts" },
      { kind: "bullet", text: "**ATP**: energy", depth: 0 },
      { kind: "bullet", text: "nested", depth: 1 },
      { kind: "numbered", text: "First", number: "1" },
      { kind: "paragraph", text: "Plain text continues" },
    ]);
    expect(inlineRuns("A **bold** and `code` run")).toEqual([{ text: "A " }, { text: "bold", bold: true }, { text: " and " }, { text: "code", code: true }, { text: " run" }]);
  });

  it("orders the learn queue and moves cards through review states", () => {
    const cards = [1, 2, 3].map((id) => ({ id, question: `q${id}`, answer: `a${id}` }));
    const queue = learnQueue(cards, [
      { flashcardId: 1, status: "mastered" },
      { flashcardId: 2, status: "learning" },
    ]);
    expect(queue.map((card) => card.id)).toEqual([3, 2]);
    expect(nextStatus(undefined, true)).toBe("learning");
    expect(nextStatus("learning", true)).toBe("mastered");
    expect(nextStatus("mastered", false)).toBe("learning");
  });
});

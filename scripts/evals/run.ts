// AI quality evals (Phase 7). Generates notes, flashcards and a quiz for a few recordings of
// the demo library and asks Ask StudyScribe some questions, through the running app exactly
// as a person would, then scores each result against its transcript (server/evals/scorers.ts)
// and compares with evals/baseline.json.
//
//   1. Run the app against a LOCAL database seeded with scripts/demo-video/v2/seed-library.mjs,
//      with a real OPENAI_API_KEY (and OPENAI_MODEL) so it generates for real.
//   2. npm run evals -- [baseUrl]            score fresh output (makes about 20 AI calls)
//      npm run evals -- --stored             score what is already stored, no AI calls
//      npm run evals -- --update-baseline    accept this run as the new baseline
//
// Exits 1 when a check fails or a score falls more than TOLERANCE below the baseline, so a
// prompt change that makes results worse is caught before it ships. Writes evals/last-run.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareWithBaseline,
  scoreAsk,
  scoreFlashcards,
  scoreNotes,
  scoreQuiz,
  toBaseline,
  type AskCase,
  type Baseline,
  type EvalResult,
  type QuizQuestion,
} from "../../server/evals/scorers";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000";
const STORED = args.includes("--stored");
const UPDATE = args.includes("--update-baseline");
const EMAIL = process.env.DEMO_USER_EMAIL || "demo@example.com";
const PASSWORD = process.env.DEMO_USER_PASSWORD || "demo-password-1";

const cases = JSON.parse(readFileSync(resolve(root, "evals/cases.json"), "utf8")) as {
  recordings: string[];
  quizQuestions: number;
  ask: AskCase[];
};
const baselinePath = resolve(root, "evals/baseline.json");
const baseline: Baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};

let cookie = "";
async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`Login failed (${response.status}). Seed the demo library first.`);
  cookie = (response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).join("; ");
}

async function trpc<T>(kind: "query" | "mutation", path: string, input: unknown): Promise<T> {
  const url = `${BASE}/api/trpc/${path}`;
  const response =
    kind === "query"
      ? await fetch(`${url}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`, { headers: { cookie } })
      : await fetch(url, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ json: input }) });
  const body = (await response.json()) as { result?: { data?: { json?: T } }; error?: { json?: { message?: string } } };
  if (body.error) throw new Error(`${path}: ${body.error.json?.message ?? "failed"}`);
  return body.result?.data?.json as T;
}

type Recording = { id: number; title: string };
type Transcript = { fullText: string } | null;

async function main() {
  await login();
  const recordings = await trpc<Recording[]>("query", "recordings.list", undefined);
  const byTitle = new Map(recordings.map((r) => [r.title, r]));
  const titles = new Map(recordings.map((r) => [r.id, r.title]));
  const results: EvalResult[] = [];
  const skipped: string[] = [];
  const failed = (id: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // With --stored, something never generated is simply not scored.
    if (STORED && message.startsWith("no ")) skipped.push(id);
    else results.push({ id, scores: {}, checks: [{ name: "ran", pass: false, detail: message }] });
  };

  for (const title of cases.recordings) {
    const recording = byTitle.get(title);
    if (!recording) {
      failed(`recording:${title}`, new Error("not in the library; run seed-library.mjs"));
      continue;
    }
    const transcript = (await trpc<Transcript>("query", "transcription.get", { recordingId: recording.id }))?.fullText ?? "";
    console.log(`\n${title}`);

    try {
      if (!STORED) await trpc("mutation", "ai.generateStudyNotes", { recordingId: recording.id });
      const notes = await trpc<Array<{ content: string; createdAt: string }>>("query", "ai.getStudyNotes", { recordingId: recording.id });
      const latest = notes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      if (!latest) throw new Error("no notes");
      results.push({ id: `notes:${title}`, ...scoreNotes(latest.content, transcript) });
    } catch (error) {
      failed(`notes:${title}`, error);
    }

    try {
      if (!STORED) await trpc("mutation", "ai.generateFlashcards", { recordingId: recording.id });
      const cards = await trpc<Array<{ question: string; answer: string }>>("query", "ai.getFlashcards", { recordingId: recording.id });
      if (!cards.length) throw new Error("no flashcards");
      results.push({ id: `flashcards:${title}`, ...scoreFlashcards(cards, transcript) });
    } catch (error) {
      failed(`flashcards:${title}`, error);
    }

    try {
      if (!STORED) await trpc("mutation", "quizzes.generate", { recordingId: recording.id, questionCount: cases.quizQuestions });
      const quizzes = await trpc<Array<{ id: number; questions: QuizQuestion[] | null; createdAt: string }>>("query", "quizzes.list", { recordingId: recording.id });
      const latest = quizzes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      if (!latest?.questions?.length) throw new Error("no quiz");
      results.push({ id: `quiz:${title}`, ...scoreQuiz(latest.questions, transcript, cases.quizQuestions) });
    } catch (error) {
      failed(`quiz:${title}`, error);
    }
  }

  if (!STORED) {
    for (const testCase of cases.ask) {
      const id = `ask:${testCase.question}`;
      try {
        const answer = await trpc<{ answer: string; citations: Array<{ recordingId: number; title?: string }> }>("mutation", "ai.askAcrossRecordings", { question: testCase.question });
        results.push({ id, ...scoreAsk(answer, testCase, titles) });
      } catch (error) {
        failed(id, error);
      }
    }
  }

  for (const r of results) {
    const scores = Object.entries(r.scores).map(([k, v]) => `${k} ${v}`).join(", ");
    const bad = r.checks.filter((c) => !c.pass);
    console.log(`${bad.length ? "FAIL" : "ok  "}  ${r.id}${scores ? `  (${scores})` : ""}${bad.length ? `\n      ${bad.map((c) => c.name + (c.detail ? `: ${c.detail}` : "")).join("\n      ")}` : ""}`);
  }

  if (skipped.length) console.log(`\nSkipped (nothing stored yet): ${skipped.join(", ")}`);
  writeFileSync(resolve(root, "evals/last-run.json"), `${JSON.stringify({ at: new Date().toISOString(), base: BASE, stored: STORED, results }, null, 2)}\n`);
  if (UPDATE) {
    writeFileSync(baselinePath, `${JSON.stringify({ ...baseline, ...toBaseline(results.filter((r) => Object.keys(r.scores).length)) }, null, 2)}\n`);
    console.log("\nBaseline updated (evals/baseline.json). Commit it with the prompt change it describes.");
    return;
  }
  const problems = compareWithBaseline(results, baseline);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} results pass${Object.keys(baseline).length ? " and none fell below the baseline" : " (no baseline yet: run with --update-baseline to set one)"}.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

// AI quality evals (Phase 7): deterministic scores for what the study tools produce,
// measured against the transcript they came from. No model is used to grade, so a
// score only moves when the output does. scripts/evals/run.ts produces the outputs.

const STOPWORDS = new Set(
  "a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your yours yourself yourselves one two three get got make made like really well going know think thing things way yes okay right lot kind sort just also may might must shall".split(
    " ",
  ),
);

/** Lowercase content words of 3+ letters, with a light stem so "reactions" meets "reaction". */
export function contentTerms(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map(stem);
}

function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("es") && /(ss|sh|ch|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Share of the output's content words that also occur in the transcript. Low grounding
 * means the output talks about things the lecture never mentioned (a hallucination proxy).
 */
export function grounding(output: string, transcript: string): number {
  const said = new Set(contentTerms(transcript));
  const terms = contentTerms(output);
  if (terms.length === 0) return 0;
  return round(terms.filter((t) => said.has(t)).length / terms.length);
}

/** The transcript's most repeated content words: a stand-in for what the lecture was about. */
export function keyTerms(transcript: string, limit = 15): string[] {
  const counts = new Map<string, number>();
  for (const t of contentTerms(transcript)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return Array.from(counts.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t]) => t);
}

/** Share of the transcript's key terms that the output mentions. */
export function coverage(output: string, transcript: string, limit = 15): number {
  const keys = keyTerms(transcript, limit);
  if (keys.length === 0) return 1;
  const used = new Set(contentTerms(output));
  return round(keys.filter((k) => used.has(k)).length / keys.length);
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type Check = { name: string; pass: boolean; detail?: string };
export type ScoreCard = { scores: Record<string, number>; checks: Check[] };

function check(name: string, pass: boolean, detail?: string): Check {
  return pass ? { name, pass } : { name, pass, detail };
}

export function scoreNotes(notes: string, transcript: string): ScoreCard {
  const words = notes.split(/\s+/).filter(Boolean).length;
  const transcriptWords = transcript.split(/\s+/).filter(Boolean).length;
  return {
    scores: { grounding: grounding(notes, transcript), coverage: coverage(notes, transcript) },
    checks: [
      check("has headings", /^#{1,3} \S/m.test(notes)),
      check("not empty", words >= 40, `${words} words`),
      check("shorter than the transcript", transcriptWords < 150 || words < transcriptWords * 1.2, `${words} vs ${transcriptWords} words`),
    ],
  };
}

export function scoreFlashcards(cards: Array<{ question: string; answer: string }>, transcript: string): ScoreCard {
  const questions = cards.map((c) => normalise(c.question));
  const duplicates = questions.length - new Set(questions).size;
  const giveaways = cards.filter((c) => normalise(c.answer).length > 0 && normalise(c.question).includes(normalise(c.answer))).length;
  const text = cards.map((c) => `${c.question} ${c.answer}`).join("\n");
  return {
    scores: { grounding: grounding(text, transcript), coverage: coverage(text, transcript) },
    checks: [
      check("5 to 20 cards", cards.length >= 5 && cards.length <= 20, `${cards.length} cards`),
      check("no empty sides", cards.every((c) => c.question.trim() && c.answer.trim())),
      check("no duplicate questions", duplicates === 0, `${duplicates} duplicates`),
      check("answers not given away in the question", giveaways === 0, `${giveaways} cards`),
    ],
  };
}

export type QuizQuestion = { question: string; type: string; options?: string[]; correctAnswer: string; explanation?: string };

export function scoreQuiz(questions: QuizQuestion[], transcript: string, expectedCount: number): ScoreCard {
  const mc = questions.filter((q) => q.type === "multiple-choice");
  const badKey = mc.filter((q) => !(q.options ?? []).some((o) => normalise(o) === normalise(q.correctAnswer))).length;
  const fewOptions = mc.filter((q) => new Set((q.options ?? []).map(normalise)).size < 3).length;
  const noExplanation = questions.filter((q) => !q.explanation?.trim()).length;
  const duplicates = questions.length - new Set(questions.map((q) => normalise(q.question))).size;
  const text = questions.map((q) => `${q.question} ${q.correctAnswer} ${q.explanation ?? ""}`).join("\n");
  return {
    scores: { grounding: grounding(text, transcript), coverage: coverage(text, transcript) },
    checks: [
      check(`${expectedCount} questions`, questions.length === expectedCount, `${questions.length} questions`),
      check("correct answer is one of the options", badKey === 0, `${badKey} questions`),
      check("at least 3 distinct options", fewOptions === 0, `${fewOptions} questions`),
      check("every question explained", noExplanation === 0, `${noExplanation} questions`),
      check("no duplicate questions", duplicates === 0, `${duplicates} duplicates`),
    ],
  };
}

export type AskCase = {
  question: string;
  /** Words a right answer has to contain. Empty for a question the library can't answer. */
  expect: string[];
  /** Title of the recording the answer should cite. */
  source?: string;
};

export function scoreAsk(
  answer: { answer: string; citations: Array<{ recordingId: number; title?: string }> },
  testCase: AskCase,
  titles: Map<number, string>,
): ScoreCard {
  const text = normalise(answer.answer);
  if (testCase.expect.length === 0) {
    return {
      scores: {},
      checks: [check("says it could not find an answer", answer.citations.length === 0, `${answer.citations.length} citations`)],
    };
  }
  const found = testCase.expect.filter((word) => text.includes(normalise(word)));
  const cited = answer.citations.map((c) => c.title ?? titles.get(c.recordingId) ?? "");
  return {
    scores: { recall: round(found.length / testCase.expect.length) },
    checks: [
      check("cites a recording", answer.citations.length > 0),
      ...(testCase.source ? [check("cites the right recording", cited.includes(testCase.source), cited.join(", ") || "none")] : []),
    ],
  };
}

// ─── Comparing with the baseline ───────────────────────────────────────────

export type EvalResult = { id: string; scores: Record<string, number>; checks: Check[] };
export type Baseline = Record<string, Record<string, number>>;

/** A score may drop this much before it counts as a regression (outputs vary run to run). */
export const TOLERANCE = 0.1;

export function compareWithBaseline(results: EvalResult[], baseline: Baseline, tolerance = TOLERANCE) {
  const problems: string[] = [];
  for (const result of results) {
    for (const failed of result.checks.filter((c) => !c.pass)) {
      problems.push(`${result.id}: ${failed.name}${failed.detail ? ` (${failed.detail})` : ""}`);
    }
    const before = baseline[result.id];
    if (!before) continue;
    for (const [metric, value] of Object.entries(result.scores)) {
      const was = before[metric];
      if (typeof was === "number" && value < was - tolerance) problems.push(`${result.id}: ${metric} fell from ${was} to ${value}`);
    }
  }
  return problems;
}

export function toBaseline(results: EvalResult[]): Baseline {
  return Object.fromEntries(results.map((r) => [r.id, r.scores]));
}

import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { Markdown } from "@/components/Markdown";
import { ArrowLeft, Check, Download, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { formatDate, t, tn, useI18n } from "@/i18n";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { MissedQuestionReview } from "@/components/practice/MissedQuestionReview";
import { PracticeMissedButton } from "@/components/practice/PracticeMissedButton";
import { PracticeStartButton } from "@/components/practice/PracticeSetup";
import { usePracticeCapabilities } from "@/hooks/usePracticeCapabilities";
import { missedItems, parseAttempt } from "@/lib/practiceModel";

type Question = {
  id: string;
  question: string;
  type: "multiple-choice" | "short-answer";
  options?: string[];
  correctAnswer: string;
  explanation: string;
  recordingId?: number;
};

type Result = { score: number; correct: number; total: number; results: Array<{ id: string; correct: boolean }> };

function downloadMarkdown(title: string, content: string) {
  const blob = new Blob([`# ${title}\n\n${content}\n`], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "exam-pack"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function PracticeExam({
  packId,
  questions,
  sourceTitles,
  onRegenerate,
  regenerating,
}: {
  packId: number;
  questions: Question[];
  sourceTitles: Map<number, string>;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  useI18n();
  const utils = trpc.useUtils();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState<ReturnType<typeof parseAttempt>>(null);
  const [attemptNo, setAttemptNo] = useState(0);
  const practice = usePracticeCapabilities();
  const summaryRef = useRef<HTMLDivElement>(null);
  const submit = trpc.examPacks.submitAttempt.useMutation({
    onSuccess: data => {
      setResult(data);
      setAttempt(parseAttempt(data));
      setAttemptNo(n => n + 1);
      void utils.examPacks.list.invalidate();
      requestAnimationFrame(() => summaryRef.current?.focus());
    },
    onError: error => toast.error(error.message || t("examPack.checkFailed")),
  });

  useEffect(() => {
    setAnswers({});
    setResult(null);
    setAttempt(null);
  }, [questions]);

  const answered = questions.filter(question => answers[question.id]?.trim()).length;
  const outcome = new Map(result?.results.map(entry => [entry.id, entry.correct]));

  return (
    <div className="space-y-6">
      {result && (
        <div ref={summaryRef} tabIndex={-1} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm outline-none sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-3xl font-bold tracking-tight tabular-nums">{result.score}%</p>
            <p className="text-sm text-muted-foreground">{t("examPack.resultText", { correct: result.correct, total: result.total })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={() => { setAnswers({}); setResult(null); setAttempt(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
              <RotateCcw className="h-4 w-4" /> {t("translate.tryAgain")}
            </Button>
            <Button variant="outline" disabled={regenerating} onClick={onRegenerate}>{t("examPack.newQuestions")}</Button>
          </div>
        </div>
      )}

      {result && practice.available && attempt && (() => {
        const filled = attempt.results.map(entry => {
          const question = questions.find(item => item.id === entry.id);
          return { ...entry, userAnswer: entry.userAnswer || answers[entry.id] || "", correctAnswer: entry.correctAnswer || question?.correctAnswer || "" };
        });
        const missed = missedItems(questions, filled);
        return missed.length > 0 ? (
          <div className="space-y-6">
            <PracticeMissedButton origin={{ packId }} allowSimilar={practice.explanations} />
            <MissedQuestionReview key={`${packId}:${attemptNo}`} origin={{ packId }} items={missed} explanations={practice.explanations} />
          </div>
        ) : null;
      })()}

      <ol className="space-y-4">
        {questions.map((question, index) => {
          const state = outcome.get(question.id);
          const source = question.recordingId ? sourceTitles.get(question.recordingId) : undefined;
          return (
            <li key={question.id} className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <fieldset disabled={!!result}>
                <legend className="flex w-full items-start gap-3">
                  <span className="mt-0.5 w-6 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                  <span className="flex-1 font-medium leading-snug">{question.question}</span>
                </legend>
                <div className="mt-4 pl-9">
                  {question.type === "multiple-choice" && question.options ? (
                    <RadioGroup value={answers[question.id] ?? ""} onValueChange={value => setAnswers(current => ({ ...current, [question.id]: value }))} className="gap-2">
                      {question.options.map((option, optionIndex) => {
                        const id = `${question.id}-${optionIndex}`;
                        const isAnswer = !!result && option === question.correctAnswer;
                        const isWrongPick = !!result && answers[question.id] === option && option !== question.correctAnswer;
                        return (
                          <Label
                            key={id}
                            htmlFor={id}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-normal transition-colors",
                              isAnswer ? "border-primary bg-primary/5" : isWrongPick ? "border-destructive/50 bg-destructive/5" : answers[question.id] === option ? "border-primary/60 bg-secondary/60" : "border-border hover:bg-muted/50",
                            )}
                          >
                            <RadioGroupItem value={option} id={id} />
                            <span className="flex-1">{option}</span>
                            {isAnswer && <Check className="h-4 w-4 text-primary" aria-label={t("examPack.correctAnswer")} />}
                            {isWrongPick && <X className="h-4 w-4 text-destructive" aria-label={t("examPack.wrongPick")} />}
                          </Label>
                        );
                      })}
                    </RadioGroup>
                  ) : (
                    <Input
                      value={answers[question.id] ?? ""}
                      onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))}
                      placeholder={t("examPack.answerPlaceholder")}
                      aria-label={t("examPack.answerLabel", { number: index + 1 })}
                      maxLength={500}
                    />
                  )}

                  {result && (
                    <div className="mt-3 space-y-1 text-sm">
                      <p className={cn("font-medium", state ? "text-primary" : "text-destructive")}>
                        {state ? t("examPack.correct") : answers[question.id]?.trim() ? t("examPack.notQuite") : t("quiz.notAnswered")}
                        {!state && question.type === "short-answer" && <span className="font-normal text-foreground">{t("examPack.answerReveal", { answer: question.correctAnswer })}</span>}
                      </p>
                      {question.explanation && <p className="text-muted-foreground">{question.explanation}</p>}
                      {source && question.recordingId && (
                        <Link href={`/recording/${question.recordingId}`} className="inline-block text-xs text-primary underline-offset-4 hover:underline">
                          {t("examPack.from", { title: source })}
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>

      {!result && (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">{t("examPack.answeredCount", { answered, total: questions.length })}</p>
          <Button disabled={answered === 0 || submit.isPending} className="gap-2" onClick={() => submit.mutate({ id: packId, answers })}>
            {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("examPack.check")}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function ExamPack() {
  const [, params] = useRoute("/exam-packs/:id");
  const id = params?.id ? Number.parseInt(params.id, 10) : NaN;
  const valid = Number.isInteger(id) && id > 0;
  useI18n();
  const isNew = new URLSearchParams(useSearch()).get("new") === "1";
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState("guide");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const autoStarted = useRef(false);

  const { data: pack, isLoading, error } = trpc.examPacks.get.useQuery({ id }, { enabled: valid, retry: false });
  const generateQuiz = trpc.examPacks.generateQuiz.useMutation({
    onSuccess: async result => {
      await Promise.all([utils.examPacks.get.invalidate({ id }), utils.examPacks.list.invalidate()]);
      toast.success(tn("examPack.examReady", result.questionCount));
    },
    onError: err => toast.error(err.message || t("examPack.writeFailed")),
  });
  const remove = trpc.examPacks.remove.useMutation({
    onSuccess: async () => {
      await utils.examPacks.list.invalidate();
      navigate("/exam-packs");
      toast.success(t("examPack.deleted"));
    },
    onError: err => toast.error(err.message || t("examPack.deleteFailed")),
  });

  const questions = (pack?.questions ?? []) as Question[];

  // A pack that was just made gets its practice exam written straight away.
  useEffect(() => {
    if (!isNew || !pack || autoStarted.current || questions.length > 0) return;
    autoStarted.current = true;
    generateQuiz.mutate({ id });
    navigate(`/exam-packs/${id}`, { replace: true });
  }, [isNew, pack, questions.length, id]);

  const sourceTitles = new Map((pack?.sources ?? []).map(source => [source.id, source.title]));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="container flex h-16 items-center justify-between gap-3">
          <Link href="/exam-packs">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("examPack.packs")}
            </Button>
          </Link>
          {pack && (
            <div className="flex items-center gap-2">
              {pack.guide && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadMarkdown(pack.title, pack.guide!)}>
                  <Download className="h-4 w-4" />
                  <span className="sr-only sm:not-sr-only">{t("examPack.downloadGuide")}</span>
                </Button>
              )}
              {questions.length > 0 && (
                <PracticeStartButton target={{ scope: "pack", packId: pack.id }} title={pack.title} questionTotal={questions.length} compactLabel />
              )}
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">{t("transcript.delete")}</span>
              </Button>
            </div>
          )}
        </div>
      </header>

      <main id="main-content" className="container max-w-3xl pb-20 pt-10" tabIndex={-1}>
        {isLoading ? (
          <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>
        ) : !pack ? (
          <div className="py-24 text-center">
            <h1 className="mb-2 text-2xl font-bold tracking-tight">{t("examPack.notFound")}</h1>
            <p className="mb-6 text-muted-foreground">{error?.message && error.message !== "Exam pack not found" ? error.message : t("examPack.maybeDeleted")}</p>
            <Link href="/exam-packs"><Button>{t("examPack.backToPacks")}</Button></Link>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              {[tn("library.recordings", pack.sources.length), formatDate(pack.createdAt), pack.lastScore !== null ? t("examPack.lastScoreInline", { score: pack.lastScore }) : null].filter(Boolean).join(" · ")}
            </p>
            <h1 className="text-4xl font-bold tracking-[-0.04em] sm:text-5xl">{pack.title}</h1>

            <section aria-label={t("examPack.sourcesLabel")} className="mt-5">
              <ul className="flex flex-wrap gap-2">
                {pack.sources.map(source => (
                  <li key={source.id} className="min-w-0 max-w-full">
                    {source.available ? (
                      <Link href={`/recording/${source.id}`} className="block max-w-full truncate rounded-full border border-border bg-card px-3 py-1 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {source.title}
                      </Link>
                    ) : (
                      <span className="block truncate rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground">{source.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <Tabs value={tab} onValueChange={setTab} className="mt-8">
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="guide" className="px-4">{t("notes.type.study_guide")}</TabsTrigger>
                <TabsTrigger value="exam" className="px-4">
                  {t("examPack.examTab")}{questions.length > 0 && <span className="tabular-nums text-muted-foreground">{questions.length}</span>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="guide" className="pt-4">
                {pack.guide ? (
                  <article className="prose prose-sm max-w-none rounded-xl border border-border bg-card p-6 text-foreground/90 shadow-sm dark:prose-invert sm:p-8 [&_h2:first-child]:mt-0 [&>*:first-child]:mt-0">
                    <Markdown>{pack.guide}</Markdown>
                  </article>
                ) : (
                  <p className="text-muted-foreground">{t("examPack.noGuide")}</p>
                )}
              </TabsContent>

              <TabsContent value="exam" className="pt-4">
                {generateQuiz.isPending ? (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card py-14 text-center shadow-sm" role="status">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="font-medium">{t("examPack.writingExam")}</p>
                    <p className="max-w-xs text-sm text-muted-foreground">{t("examPack.writingExamText")}</p>
                  </div>
                ) : questions.length > 0 ? (
                  <PracticeExam
                    packId={pack.id}
                    questions={questions}
                    sourceTitles={sourceTitles}
                    regenerating={generateQuiz.isPending}
                    onRegenerate={() => generateQuiz.mutate({ id: pack.id })}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
                    <p className="mx-auto max-w-sm text-muted-foreground">{t("examPack.emptyExam")}</p>
                    <Button className="mt-5" onClick={() => generateQuiz.mutate({ id: pack.id })}>{t("examPack.writeExam")}</Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("examPack.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("examPack.deleteText")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("examPack.keep")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate({ id })}>{t("transcript.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

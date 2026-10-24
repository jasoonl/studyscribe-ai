import { localIsoDate } from "@shared/actionItems";
import { useState } from "react";
import { useParams, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDate, t, tn, useI18n } from "@/i18n";
import { MissedQuestionReview } from "@/components/practice/MissedQuestionReview";
import { PracticeMissedButton } from "@/components/practice/PracticeMissedButton";
import { PracticeStartButton } from "@/components/practice/PracticeSetup";
import { usePracticeCapabilities } from "@/hooks/usePracticeCapabilities";
import { missedItems, parseAttempt } from "@/lib/practiceModel";
import {
  Brain, ArrowLeft, Sparkles, Clock, ChevronRight, CheckCircle2,
  XCircle, Trophy, RotateCcw, ListChecks
} from "lucide-react";

type QuizQuestion = {
  id: string;
  question: string;
  type: "multiple-choice" | "short-answer";
  options?: string[];
  correctAnswer: string;
  explanation: string;
};

type QuizMode = "list" | "taking" | "results";

export default function QuizPage() {
  useI18n();
  const { recordingId } = useParams<{ recordingId: string }>();
  const recId = parseInt(recordingId || "0", 10);

  const [selectedQuizId, setSelectedQuizId] = useState<number | null>(null);
  const [mode, setMode] = useState<QuizMode>("list");
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<{ score: number; correct: number; total: number } | null>(null);
  const [showExplanations, setShowExplanations] = useState(false);
  // Per-question results from a server that has them; null for an older one, and then nothing new shows.
  const [attempt, setAttempt] = useState<ReturnType<typeof parseAttempt>>(null);
  // Each submit is its own attempt: the review below starts fresh for it.
  const [attemptNo, setAttemptNo] = useState(0);
  const practice = usePracticeCapabilities();

  const { data: recording } = trpc.recordings.get.useQuery({ id: recId }, { enabled: !!recId });
  const { data: quizzes, isLoading, refetch } = trpc.quizzes.list.useQuery(
    { recordingId: recId },
    { enabled: !!recId }
  );
  const { data: activeQuiz } = trpc.quizzes.get.useQuery(
    { id: selectedQuizId! },
    { enabled: !!selectedQuizId }
  );

  const generateMutation = trpc.quizzes.generate.useMutation({
    onSuccess: (data) => {
      toast.success(tn("quiz.generated", data.questionCount));
      refetch();
    },
    onError: (err) => toast.error(err.message || t("quiz.generateFailed")),
  });

  const submitMutation = trpc.quizzes.submitAttempt.useMutation({
    onSuccess: (data) => {
      setResults(data);
      setAttempt(parseAttempt(data));
      setAttemptNo(n => n + 1);
      setMode("results");
    },
    onError: (err) => toast.error(err.message || t("quiz.submitFailed")),
  });

  const questions: QuizQuestion[] = (activeQuiz?.questions as QuizQuestion[]) || [];

  const handleStartQuiz = (quizId: number) => {
    setSelectedQuizId(quizId);
    setAnswers({});
    setCurrentQ(0);
    setResults(null);
    setAttempt(null);
    setShowExplanations(false);
    setMode("taking");
  };

  const handleAnswer = (questionId: string, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const handleNext = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentQ > 0) setCurrentQ(prev => prev - 1);
  };

  const handleSubmit = () => {
    if (!selectedQuizId) return;
    submitMutation.mutate({ quizId: selectedQuizId, answers, localDate: localIsoDate(new Date()) });
  };

  const handleRetry = () => {
    setAnswers({});
    setCurrentQ(0);
    setResults(null);
    setAttempt(null);
    setShowExplanations(false);
    setMode("taking");
  };

  const answeredCount = Object.keys(answers).length;
  const progress = questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;

  if (mode === "taking" && activeQuiz && questions.length > 0) {
    const q = questions[currentQ];
    const isAnswered = !!answers[q.id];

    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background focus:outline-none">
        {/* Quiz header */}
        <div className="border-b border-border bg-card sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <Button variant="ghost" size="sm" onClick={() => setMode("list")} className="gap-1 shrink-0">
                  <ArrowLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">{t("quiz.exit")}</span>
                </Button>
                <span className="text-xs sm:text-sm font-medium truncate">{activeQuiz.title}</span>
              </div>
              <span className="text-xs sm:text-sm text-muted-foreground shrink-0">
                {currentQ + 1} / {questions.length}
              </span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 py-8">
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                  {currentQ + 1}
                </div>
                <div className="flex-1">
                  <Badge variant="outline" className="mb-2 text-xs">
                    {q.type === "multiple-choice" ? t("cards.multipleChoice") : t("quiz.shortAnswer")}
                  </Badge>
                  <CardTitle className="text-base font-medium leading-relaxed">{q.question}</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {q.type === "multiple-choice" && q.options ? (
                <RadioGroup
                  value={answers[q.id] || ""}
                  onValueChange={(val) => handleAnswer(q.id, val)}
                  className="space-y-2"
                >
                  {q.options.map((opt, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-colors ${
                        answers[q.id] === opt
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50 hover:bg-muted/30"
                      }`}
                      onClick={() => handleAnswer(q.id, opt)}
                    >
                      <RadioGroupItem value={opt} id={`opt-${i}`} />
                      <Label htmlFor={`opt-${i}`} className="cursor-pointer flex-1">{opt}</Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <Textarea
                  placeholder={t("quiz.answerPlaceholder")}
                  value={answers[q.id] || ""}
                  onChange={(e) => handleAnswer(q.id, e.target.value)}
                  className="min-h-[100px] resize-none"
                />
              )}

              <div className="flex items-center justify-between mt-6">
                <Button variant="outline" onClick={handlePrev} disabled={currentQ === 0} size="sm">
                  {t("cards.previous")}
                </Button>
                <div className="flex gap-2">
                  {currentQ < questions.length - 1 ? (
                    <Button onClick={handleNext} size="sm" className="">
                      {t("cards.next")}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleSubmit}
                      disabled={submitMutation.isPending || answeredCount === 0}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {submitMutation.isPending ? t("quiz.submitting") : t("quiz.submitCount", { answered: answeredCount, total: questions.length })}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Question navigation dots */}
          <div className="flex flex-wrap gap-1 sm:gap-2 mt-4 justify-center">
            {questions.map((q, i) => (
              <button
                key={i}
                onClick={() => setCurrentQ(i)}
                className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full text-xs font-medium transition-colors ${
                  i === currentQ
                    ? "bg-primary text-white"
                    : answers[q.id]
                    ? "bg-primary/30 text-primary"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (mode === "results" && results && activeQuiz) {
    const scoreColor = results.score >= 80 ? "text-green-400" : results.score >= 60 ? "text-yellow-400" : "text-red-400";
    const questions: QuizQuestion[] = (activeQuiz.questions as QuizQuestion[]) || [];

    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-background focus:outline-none">
        <div className="border-b border-border bg-card sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setMode("list")} className="gap-1">
              <ArrowLeft className="w-4 h-4" />
              {t("quiz.backToQuizzes")}
            </Button>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
          {/* Score card */}
          <Card className="text-center">
            <CardContent className="pt-8 pb-6">
              <Trophy className={`w-12 h-12 mx-auto mb-3 ${scoreColor}`} />
              <p className={`text-5xl font-bold mb-1 ${scoreColor}`}>{results.score}%</p>
              <p className="text-muted-foreground">{t("quiz.scoreCorrect", { correct: results.correct, total: results.total })}</p>
              <div className="flex gap-3 justify-center mt-6">
                <Button onClick={handleRetry} variant="outline" className="gap-2">
                  <RotateCcw className="w-4 h-4" />
                  {t("quiz.retry")}
                </Button>
                <Button
                  onClick={() => setShowExplanations(!showExplanations)}
                  variant="outline"
                  className="gap-2"
                >
                  <ListChecks className="w-4 h-4" />
                  {showExplanations ? t("quiz.hideAnswers") : t("quiz.reviewAnswers")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Missed questions with explanations, and practice on them (only when the server has both) */}
          {practice.available && attempt && selectedQuizId && (() => {
            const missed = missedItems(questions, attempt.results);
            return missed.length > 0 ? (
              <div className="space-y-6">
                <PracticeMissedButton origin={{ quizId: selectedQuizId }} allowSimilar={practice.explanations} />
                <MissedQuestionReview key={`${selectedQuizId}:${attempt.attemptId ?? attemptNo}`} origin={{ quizId: selectedQuizId }} items={missed} explanations={practice.explanations} />
              </div>
            ) : null;
          })()}

          {/* Answer review */}
          {showExplanations && questions.map((q, i) => {
            const userAnswer = answers[q.id];
            // A server that scores each question says which were right; otherwise the plain comparison as before.
            const serverResult = attempt?.results.find(entry => entry.id === q.id);
            const isCorrect = serverResult ? serverResult.correct : userAnswer?.trim().toLowerCase() === q.correctAnswer?.trim().toLowerCase();
            return (
              <Card key={q.id} className={`border ${isCorrect ? "border-green-500/30" : "border-red-500/30"}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-2">
                    {isCorrect
                      ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                      : <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />}
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">{t("quiz.questionNumber", { number: i + 1 })}</p>
                      <p className="text-sm font-medium">{q.question}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div className="text-sm">
                    <span className="text-muted-foreground">{t("cards.yourAnswer")} </span>
                    <span className={isCorrect ? "text-green-400" : "text-red-400"}>
                      {userAnswer || <em className="text-muted-foreground">{t("quiz.notAnswered")}</em>}
                    </span>
                  </div>
                  {!isCorrect && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">{t("cards.correctAnswer")} </span>
                      <span className="text-green-400">{q.correctAnswer}</span>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2 mt-2">
                    <span className="font-medium">{t("quiz.explanation")} </span>{q.explanation}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>
    );
  }

  // List mode
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background focus:outline-none">
      <div className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href={`/recording/${recId}`}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              {t("recording.back")}
            </Button>
          </Link>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Brain className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <h1 className="font-semibold text-sm truncate">{t("quiz.title")}</h1>
              {recording && <p className="text-xs text-muted-foreground truncate">{recording.title}</p>}
            </div>
          </div>
          <Button
            onClick={() => generateMutation.mutate({ recordingId: recId, questionCount: 10 })}
            disabled={generateMutation.isPending}
            size="sm"
            className="gap-2 shrink-0"
          >
            <Sparkles className="w-4 h-4" />
            {generateMutation.isPending ? t("quiz.generating") : t("quiz.generate")}
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {generateMutation.isPending && (
          <Card className="mb-4 border-primary/30 bg-primary/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-primary animate-pulse" />
              </div>
              <div>
                <p className="text-sm font-medium">{t("quiz.progressTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("quiz.progressText", { count: 10 })}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
          </div>
        ) : quizzes?.length === 0 ? (
          <Card className="border-dashed max-w-md mx-auto mt-12">
            <CardContent className="p-8 text-center">
              <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium mb-1">{t("quiz.emptyTitle")}</p>
              <p className="text-sm text-muted-foreground mb-4">{t("quiz.emptyText")}</p>
              <Button
                onClick={() => generateMutation.mutate({ recordingId: recId, questionCount: 10 })}
                disabled={generateMutation.isPending}
                className="gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {t("quiz.generate")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {quizzes?.map((quiz) => {
              const qCount = Array.isArray(quiz.questions) ? quiz.questions.length : 0;
              return (
                <Card key={quiz.id} className="hover:border-primary/50 transition-colors cursor-pointer group">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <Brain className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <Badge variant="outline" className="text-xs shrink-0">
                        {tn("quiz.questions", qCount)}
                      </Badge>
                    </div>
                    <CardTitle className="text-sm mt-2 leading-snug">{quiz.title}</CardTitle>
                    {quiz.description && (
                      <CardDescription className="text-xs line-clamp-2">{quiz.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
                      <Clock className="w-3 h-3" />
                      {formatDate(quiz.createdAt)}
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        onClick={() => handleStartQuiz(quiz.id)}
                        size="sm"
                        className="w-full gap-2"
                      >
                        <ChevronRight className="w-4 h-4" />
                        {t("quiz.start")}
                      </Button>
                      <PracticeStartButton target={{ scope: "quiz", quizId: quiz.id }} title={quiz.title} questionTotal={qCount} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

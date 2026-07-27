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
  const { recordingId } = useParams<{ recordingId: string }>();
  const recId = parseInt(recordingId || "0", 10);

  const [selectedQuizId, setSelectedQuizId] = useState<number | null>(null);
  const [mode, setMode] = useState<QuizMode>("list");
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<{ score: number; correct: number; total: number } | null>(null);
  const [showExplanations, setShowExplanations] = useState(false);

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
      toast.success(`Quiz with ${data.questionCount} questions generated!`);
      refetch();
    },
    onError: (err) => toast.error(err.message || "Failed to generate quiz"),
  });

  const submitMutation = trpc.quizzes.submitAttempt.useMutation({
    onSuccess: (data) => {
      setResults(data);
      setMode("results");
    },
    onError: (err) => toast.error(err.message || "Failed to submit quiz"),
  });

  const questions: QuizQuestion[] = (activeQuiz?.questions as QuizQuestion[]) || [];

  const handleStartQuiz = (quizId: number) => {
    setSelectedQuizId(quizId);
    setAnswers({});
    setCurrentQ(0);
    setResults(null);
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
    submitMutation.mutate({ quizId: selectedQuizId, answers });
  };

  const handleRetry = () => {
    setAnswers({});
    setCurrentQ(0);
    setResults(null);
    setShowExplanations(false);
    setMode("taking");
  };

  const answeredCount = Object.keys(answers).length;
  const progress = questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;

  if (mode === "taking" && activeQuiz && questions.length > 0) {
    const q = questions[currentQ];
    const isAnswered = !!answers[q.id];

    return (
      <div className="min-h-screen bg-background">
        {/* Quiz header */}
        <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setMode("list")} className="gap-1">
                  <ArrowLeft className="w-4 h-4" />
                  Exit
                </Button>
                <span className="text-sm font-medium truncate max-w-[200px]">{activeQuiz.title}</span>
              </div>
              <span className="text-sm text-muted-foreground">
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
                <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0 text-sm font-bold text-indigo-400">
                  {currentQ + 1}
                </div>
                <div className="flex-1">
                  <Badge variant="outline" className="mb-2 text-xs">
                    {q.type === "multiple-choice" ? "Multiple Choice" : "Short Answer"}
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
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        answers[q.id] === opt
                          ? "border-indigo-500 bg-indigo-50/10"
                          : "border-border hover:border-indigo-400/50 hover:bg-muted/30"
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
                  placeholder="Type your answer here…"
                  value={answers[q.id] || ""}
                  onChange={(e) => handleAnswer(q.id, e.target.value)}
                  className="min-h-[100px] resize-none"
                />
              )}

              <div className="flex items-center justify-between mt-6">
                <Button variant="outline" onClick={handlePrev} disabled={currentQ === 0} size="sm">
                  Previous
                </Button>
                <div className="flex gap-2">
                  {currentQ < questions.length - 1 ? (
                    <Button onClick={handleNext} size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white">
                      Next
                    </Button>
                  ) : (
                    <Button
                      onClick={handleSubmit}
                      disabled={submitMutation.isPending || answeredCount === 0}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {submitMutation.isPending ? "Submitting…" : `Submit (${answeredCount}/${questions.length} answered)`}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Question navigation dots */}
          <div className="flex flex-wrap gap-2 mt-4 justify-center">
            {questions.map((q, i) => (
              <button
                key={i}
                onClick={() => setCurrentQ(i)}
                className={`w-8 h-8 rounded-full text-xs font-medium transition-colors ${
                  i === currentQ
                    ? "bg-indigo-600 text-white"
                    : answers[q.id]
                    ? "bg-indigo-500/30 text-indigo-300"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (mode === "results" && results && activeQuiz) {
    const scoreColor = results.score >= 80 ? "text-green-400" : results.score >= 60 ? "text-yellow-400" : "text-red-400";
    const questions: QuizQuestion[] = (activeQuiz.questions as QuizQuestion[]) || [];

    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setMode("list")} className="gap-1">
              <ArrowLeft className="w-4 h-4" />
              Back to Quizzes
            </Button>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
          {/* Score card */}
          <Card className="text-center">
            <CardContent className="pt-8 pb-6">
              <Trophy className={`w-12 h-12 mx-auto mb-3 ${scoreColor}`} />
              <p className={`text-5xl font-bold mb-1 ${scoreColor}`}>{results.score}%</p>
              <p className="text-muted-foreground">{results.correct} out of {results.total} correct</p>
              <div className="flex gap-3 justify-center mt-6">
                <Button onClick={handleRetry} variant="outline" className="gap-2">
                  <RotateCcw className="w-4 h-4" />
                  Retry Quiz
                </Button>
                <Button
                  onClick={() => setShowExplanations(!showExplanations)}
                  variant="outline"
                  className="gap-2"
                >
                  <ListChecks className="w-4 h-4" />
                  {showExplanations ? "Hide" : "Review"} Answers
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Answer review */}
          {showExplanations && questions.map((q, i) => {
            const userAnswer = answers[q.id];
            const isCorrect = userAnswer?.trim().toLowerCase() === q.correctAnswer?.trim().toLowerCase();
            return (
              <Card key={q.id} className={`border ${isCorrect ? "border-green-500/30" : "border-red-500/30"}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-2">
                    {isCorrect
                      ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                      : <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />}
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Question {i + 1}</p>
                      <p className="text-sm font-medium">{q.question}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Your answer: </span>
                    <span className={isCorrect ? "text-green-400" : "text-red-400"}>
                      {userAnswer || <em className="text-muted-foreground">Not answered</em>}
                    </span>
                  </div>
                  {!isCorrect && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Correct answer: </span>
                      <span className="text-green-400">{q.correctAnswer}</span>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2 mt-2">
                    <span className="font-medium">Explanation: </span>{q.explanation}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // List mode
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href={`/recording/${recId}`}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          </Link>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Brain className="w-5 h-5 text-purple-500 shrink-0" />
            <div className="min-w-0">
              <h1 className="font-semibold text-sm truncate">Practice Quizzes</h1>
              {recording && <p className="text-xs text-muted-foreground truncate">{recording.title}</p>}
            </div>
          </div>
          <Button
            onClick={() => generateMutation.mutate({ recordingId: recId, questionCount: 10 })}
            disabled={generateMutation.isPending}
            size="sm"
            className="gap-2 bg-purple-600 hover:bg-purple-700 text-white shrink-0"
          >
            <Sparkles className="w-4 h-4" />
            {generateMutation.isPending ? "Generating…" : "Generate Quiz"}
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {generateMutation.isPending && (
          <Card className="mb-4 border-purple-500/30 bg-purple-50/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
              </div>
              <div>
                <p className="text-sm font-medium">Generating quiz questions…</p>
                <p className="text-xs text-muted-foreground">AI is creating 10 questions from the transcript.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
          </div>
        ) : quizzes?.length === 0 ? (
          <Card className="border-dashed max-w-md mx-auto mt-12">
            <CardContent className="p-8 text-center">
              <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium mb-1">No quizzes yet</p>
              <p className="text-sm text-muted-foreground mb-4">Generate a quiz from the transcript to start practicing.</p>
              <Button
                onClick={() => generateMutation.mutate({ recordingId: recId, questionCount: 10 })}
                disabled={generateMutation.isPending}
                className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
              >
                <Sparkles className="w-4 h-4" />
                Generate Quiz
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quizzes?.map((quiz) => {
              const qCount = Array.isArray(quiz.questions) ? quiz.questions.length : 0;
              return (
                <Card key={quiz.id} className="hover:border-purple-400/50 transition-colors cursor-pointer group">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <Brain className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                      <Badge variant="outline" className="text-xs shrink-0">
                        {qCount} questions
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
                      {new Date(quiz.createdAt).toLocaleDateString()}
                    </div>
                    <Button
                      onClick={() => handleStartQuiz(quiz.id)}
                      size="sm"
                      className="w-full gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      <ChevronRight className="w-4 h-4" />
                      Start Quiz
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

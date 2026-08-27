import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardCheck, RotateCcw, Target, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { buildTestQuestions, scoreMasteryTest } from "@/lib/masteryModes";

type Flashcard = {
  id: number;
  question: string;
  answer: string;
};

interface FlashcardTestModeProps {
  cards: Flashcard[];
  onExit: () => void;
}

export function FlashcardTestMode({ cards, onExit }: FlashcardTestModeProps) {
  const questions = useMemo(() => buildTestQuestions(cards), [cards]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const score = useMemo(() => isSubmitted ? scoreMasteryTest(questions, answers) : null, [answers, isSubmitted, questions]);
  const answeredCount = Object.keys(answers).filter((key) => answers[Number(key)].trim()).length;

  const resetTest = () => {
    setAnswers({});
    setIsSubmitted(false);
  };

  if (cards.length === 0) return null;

  if (isSubmitted && score) {
    return (
      <div className="space-y-4">
        <Card className="border-2 border-primary/20 bg-gradient-to-r from-indigo-50 to-cyan-50 p-6 text-center dark:from-indigo-950/30 dark:to-cyan-950/30">
          <Target className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">Mastery Test result</p>
          <p className="mt-1 text-5xl font-bold tracking-tight">{score.percentage}%</p>
          <p className="mt-2 text-sm text-muted-foreground">{score.correct} of {score.total} answers correct</p>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Button variant="outline" onClick={onExit}><ArrowLeft className="mr-2 h-4 w-4" /> Study modes</Button>
            <Button onClick={resetTest}><RotateCcw className="mr-2 h-4 w-4" /> Take again</Button>
          </div>
        </Card>

        <div className="space-y-3">
          {questions.map((question, index) => {
            const result = score.results.find((item) => item.flashcardId === question.card.id);
            return (
              <Card key={question.card.id} className={`border p-4 ${result?.correct ? "border-emerald-300" : "border-amber-300"}`}>
                <div className="flex gap-3">
                  {result?.correct ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{index + 1}. {question.card.question}</p>
                    <p className="mt-2 text-sm"><span className="font-medium">Your answer:</span> {answers[question.card.id] || "No answer"}</p>
                    {!result?.correct && <p className="mt-1 text-sm text-muted-foreground"><span className="font-medium text-foreground">Correct answer:</span> {question.card.answer}</p>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-2 border-primary/20 bg-gradient-to-r from-indigo-50 to-cyan-50 p-4 dark:from-indigo-950/30 dark:to-cyan-950/30 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-primary" /> Test Mode</div>
            <p className="mt-1 text-sm text-muted-foreground">A mixed-format practice test created from this recording’s flashcards. Answers are shown only after you submit.</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={onExit}><ArrowLeft className="mr-1 h-4 w-4" /> Study modes</Button>
        </div>
        <p className="mt-4 text-xs font-medium text-muted-foreground">{questions.length} questions · multiple choice and written recall</p>
      </Card>

      <div className="space-y-4">
        {questions.map((question, index) => (
          <Card key={question.card.id} className="border-2 border-border p-5 sm:p-6">
            <div className="mb-4 flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</span>
              <div>
                <span className="text-xs font-medium text-muted-foreground">{question.type === "written" ? "Written recall" : "Multiple choice"}</span>
                <h3 className="mt-1 font-semibold leading-relaxed">{question.card.question}</h3>
              </div>
            </div>
            {question.type === "multiple-choice" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {question.options?.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setAnswers((current) => ({ ...current, [question.card.id]: option }))}
                    className={`rounded-lg border p-3 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${answers[question.card.id] === option ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <Textarea
                value={answers[question.card.id] ?? ""}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.card.id]: event.target.value }))}
                placeholder="Write your answer from memory…"
                className="min-h-24 resize-none"
              />
            )}
          </Card>
        ))}
      </div>

      <Card className="sticky bottom-3 border-2 border-border bg-card/95 p-4 backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">{answeredCount}/{questions.length}</span> questions answered</p>
          <Button onClick={() => setIsSubmitted(true)} disabled={answeredCount === 0}><ClipboardCheck className="mr-2 h-4 w-4" /> Submit test</Button>
        </div>
      </Card>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleHelp, Lightbulb, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { buildAnswerOptions, getLearnQuestionType, getLearnQueue, getLearnReviewStatus, isStudyAnswerCorrect } from "@/lib/masteryModes";
import type { FlashcardReviewState } from "@/lib/flashcardReview";
import { toast } from "sonner";

type Flashcard = {
  id: number;
  question: string;
  answer: string;
};

interface FlashcardLearnModeProps {
  recordingId: number;
  cards: Flashcard[];
  reviews?: FlashcardReviewState[];
  onExit: () => void;
}

export function FlashcardLearnMode({ recordingId, cards, reviews = [], onExit }: FlashcardLearnModeProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const utils = trpc.useUtils();

  const queue = useMemo(() => getLearnQueue(cards, reviews), [cards, reviews]);
  const currentCard = queue[activeIndex];
  const currentReview = reviews.find((review) => review.flashcardId === currentCard?.id);
  const questionType = getLearnQuestionType(currentReview);
  const options = useMemo(
    () => currentCard ? buildAnswerOptions(cards, currentCard, activeIndex) : [],
    [activeIndex, cards, currentCard],
  );

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(queue.length - 1, 0)));
    setAnswer("");
    setChecked(false);
  }, [queue.length]);

  const reviewMutation = trpc.ai.reviewFlashcard.useMutation({
    onSuccess: async () => {
      await utils.ai.getFlashcardReviews.invalidate({ recordingId });
    },
    onError: (error) => toast.error(error.message || "Unable to save learning progress."),
  });

  const checkAnswer = () => {
    if (!currentCard || !answer.trim()) {
      toast.error("Choose or write an answer before checking it.");
      return;
    }
    setIsCorrect(isStudyAnswerCorrect(answer, currentCard.answer));
    setChecked(true);
  };

  const continueLearning = async () => {
    if (!currentCard || !checked) return;
    const status = getLearnReviewStatus(isCorrect, currentReview);
    try {
      await reviewMutation.mutateAsync({ recordingId, flashcardId: currentCard.id, status });
      setActiveIndex((index) => (index + 1) % Math.max(queue.length, 1));
      setAnswer("");
      setChecked(false);
    } catch {
      // The mutation error handler gives the user actionable feedback.
    }
  };

  if (!currentCard) {
    return (
      <Card className="border-2 border-border p-8 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
        <h3 className="text-lg font-bold">Your Learn queue is clear</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">All cards are currently mastered. Revisit Flashcards to study the full set or take a Test to check your recall.</p>
        <Button className="mt-5" variant="outline" onClick={onExit}>Back to study modes</Button>
      </Card>
    );
  }

  const progress = queue.length ? Math.round(((activeIndex + 1) / queue.length) * 100) : 100;

  return (
    <div className="space-y-4">
      <Card className="border-2 border-primary/20 bg-gradient-to-r from-cyan-50 to-indigo-50 p-4 dark:from-cyan-950/30 dark:to-indigo-950/30 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Learn Mode</div>
            <p className="mt-1 text-sm text-muted-foreground">Start with recognition, then graduate to written recall as you build confidence.</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={onExit}><ArrowLeft className="mr-1 h-4 w-4" /> Study modes</Button>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-background/80"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-600 transition-all" style={{ width: `${progress}%` }} /></div>
        <p className="mt-2 text-xs font-medium text-muted-foreground">{activeIndex + 1} of {queue.length} cards in your active learning queue</p>
      </Card>

      <Card className="border-2 border-border p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{questionType === "written" ? "Written recall" : "Multiple choice"}</span>
          <span className="text-xs text-muted-foreground">Card {activeIndex + 1}</span>
        </div>
        <h3 className="text-xl font-semibold leading-relaxed sm:text-2xl">{currentCard.question}</h3>

        <div className="mt-6 space-y-3">
          {questionType === "multiple-choice" ? (
            options.map((option) => {
              const selected = answer === option;
              const shouldRevealCorrect = checked && isStudyAnswerCorrect(option, currentCard.answer);
              const shouldRevealWrong = checked && selected && !shouldRevealCorrect;
              return (
                <button
                  key={option}
                  type="button"
                  disabled={checked}
                  onClick={() => setAnswer(option)}
                  className={`w-full rounded-xl border p-4 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-default ${
                    shouldRevealCorrect ? "border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100" : shouldRevealWrong ? "border-destructive bg-destructive/10" : selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
                  }`}
                >
                  {option}
                </button>
              );
            })
          ) : (
            <Textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={checked}
              placeholder="Write the answer from memory…"
              className="min-h-28 resize-none"
            />
          )}
        </div>

        {checked && (
          <div className={`mt-5 rounded-xl border p-4 ${isCorrect ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100" : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"}`}>
            <div className="flex gap-3">
              {isCorrect ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <Lightbulb className="mt-0.5 h-5 w-5 shrink-0" />}
              <div>
                <p className="font-semibold">{isCorrect ? "Correct — nice recall." : "Keep working on this concept."}</p>
                <p className="mt-1 text-sm">{currentCard.answer}</p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          {!checked ? (
            <Button className="sm:min-w-36" onClick={checkAnswer}><CircleHelp className="mr-2 h-4 w-4" /> Check answer</Button>
          ) : (
            <Button className="sm:min-w-40" onClick={continueLearning} disabled={reviewMutation.isPending}>
              {reviewMutation.isPending ? "Saving…" : isCorrect ? "Continue learning" : "Review and continue"}
              <RotateCcw className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

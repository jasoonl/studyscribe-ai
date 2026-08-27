import { useEffect, useMemo, useState } from "react";
import { Brain, CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { buildFlashcardReviewSummary, type FlashcardReviewState } from "@/lib/flashcardReview";
import { toast } from "sonner";

type Flashcard = {
  id: number;
  question: string;
  answer: string;
  difficulty: "easy" | "medium" | "hard" | null;
};

interface FlashcardReviewProps {
  recordingId: number;
  cards: Flashcard[];
  reviews?: FlashcardReviewState[];
  onExit: () => void;
}

export function FlashcardReview({ recordingId, cards, reviews = [], onExit }: FlashcardReviewProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [includeMastered, setIncludeMastered] = useState(false);
  const utils = trpc.useUtils();

  const { reviewQueue, counts } = useMemo(
    () => buildFlashcardReviewSummary(cards, reviews, includeMastered),
    [cards, reviews, includeMastered],
  );

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(reviewQueue.length - 1, 0)));
    setIsRevealed(false);
  }, [reviewQueue.length]);

  const reviewMutation = trpc.ai.reviewFlashcard.useMutation({
    onSuccess: async () => {
      await utils.ai.getFlashcardReviews.invalidate({ recordingId });
    },
    onError: (error) => {
      toast.error(error.message || "Unable to save your review. Please try again.");
    },
  });

  const currentCard = reviewQueue[activeIndex];
  const progress = reviewQueue.length ? ((activeIndex + 1) / reviewQueue.length) * 100 : 100;

  const selectCard = (index: number) => {
    setActiveIndex(index);
    setIsRevealed(false);
  };

  const saveReview = async (status: "learning" | "mastered") => {
    if (!currentCard) return;
    await reviewMutation.mutateAsync({
      recordingId,
      flashcardId: currentCard.id,
      status,
    });

    if (status === "mastered" && !includeMastered) {
      setActiveIndex((current) => Math.max(0, Math.min(current, reviewQueue.length - 2)));
    } else {
      setActiveIndex((current) => (current + 1) % Math.max(reviewQueue.length, 1));
    }
    setIsRevealed(false);
  };

  if (cards.length === 0) return null;

  if (!currentCard) {
    return (
      <Card className="border-2 border-border p-8 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
        <h3 className="text-lg font-bold">You’ve mastered this set</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          All {cards.length} cards are marked as known. Review them again anytime to keep the concepts fresh.
        </p>
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          <Button variant="outline" onClick={onExit}>Browse cards</Button>
          <Button className="gap-2" onClick={() => setIncludeMastered(true)}>
            <RotateCcw className="h-4 w-4" /> Review mastered cards
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-2 border-border p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Brain className="h-4 w-4 text-primary" />
              Flashcard Review
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Recall the answer before you reveal it, then tell StudyScribe what you know.</p>
          </div>
          <Button variant="outline" size="sm" onClick={onExit}>Browse cards</Button>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary" aria-label={`${Math.round(progress)}% through review set`}>
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-600 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md bg-slate-100 px-2 py-2 dark:bg-slate-800"><span className="font-bold">{counts.new}</span><span className="ml-1 text-muted-foreground">new</span></div>
          <div className="rounded-md bg-amber-50 px-2 py-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><span className="font-bold">{counts.learning}</span><span className="ml-1 opacity-80">learning</span></div>
          <div className="rounded-md bg-emerald-50 px-2 py-2 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"><span className="font-bold">{counts.mastered}</span><span className="ml-1 opacity-80">mastered</span></div>
        </div>
      </Card>

      <Card className="overflow-hidden border-2 border-border">
        <div className="border-b border-border bg-muted/40 px-5 py-3 text-xs font-medium text-muted-foreground sm:px-7">
          Card {activeIndex + 1} of {reviewQueue.length} {includeMastered ? "· all cards" : "· cards to review"}
        </div>
        <button
          type="button"
          onClick={() => setIsRevealed((revealed) => !revealed)}
          className="block min-h-72 w-full p-6 text-left transition-colors hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary sm:min-h-80 sm:p-8"
          aria-label={isRevealed ? "Hide flashcard answer" : "Reveal flashcard answer"}
        >
          <div className="flex h-full flex-col justify-between gap-8">
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{isRevealed ? "Answer" : "Question"}</span>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs capitalize text-muted-foreground">{currentCard.difficulty ?? "medium"}</span>
              </div>
              <p className="text-xl font-semibold leading-relaxed sm:text-2xl">{isRevealed ? currentCard.answer : currentCard.question}</p>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Sparkles className="h-4 w-4" />
              {isRevealed ? "Tap the card to hide the answer" : "Think of your answer, then tap to reveal"}
            </div>
          </div>
        </button>
      </Card>

      {isRevealed ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            className="h-auto min-h-14 justify-start gap-3 border-amber-300 px-4 py-3 text-left hover:bg-amber-50 dark:border-amber-800 dark:hover:bg-amber-950/30"
            onClick={() => saveReview("learning")}
            disabled={reviewMutation.isPending}
          >
            <RotateCcw className="h-5 w-5 shrink-0 text-amber-600" />
            <span><span className="block font-semibold">Review again</span><span className="block text-xs font-normal text-muted-foreground">Keep this card in your learning queue.</span></span>
          </Button>
          <Button
            className="h-auto min-h-14 justify-start gap-3 bg-emerald-600 px-4 py-3 text-left hover:bg-emerald-700"
            onClick={() => saveReview("mastered")}
            disabled={reviewMutation.isPending}
          >
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span><span className="block font-semibold">I know this</span><span className="block text-xs font-normal text-emerald-50">Mark it mastered and move on.</span></span>
          </Button>
        </div>
      ) : (
        <Button className="w-full" onClick={() => setIsRevealed(true)}>Reveal answer</Button>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => selectCard((activeIndex - 1 + reviewQueue.length) % reviewQueue.length)} disabled={reviewQueue.length < 2}>
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => selectCard((activeIndex + 1) % reviewQueue.length)} disabled={reviewQueue.length < 2}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

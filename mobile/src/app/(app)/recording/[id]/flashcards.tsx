import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Layers } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, ProgressBar, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { learnQueue, masteryCounts, nextStatus, shuffle, type Card as Flashcard, type Review } from "@/lib/flashcardDeck";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

export default function FlashcardsScreen() {
  const recordingId = Number(useLocalSearchParams<{ id: string }>().id);
  const theme = useTheme();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<"learn" | "test">("learn");
  const cards = trpc.ai.getFlashcards.useQuery({ recordingId });
  const reviews = trpc.ai.getFlashcardReviews.useQuery({ recordingId });
  const generate = trpc.ai.generateFlashcards.useMutation({
    onSuccess: () => utils.ai.getFlashcards.invalidate({ recordingId }),
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  const deck = (cards.data ?? []) as Flashcard[];
  const reviewList = (reviews.data ?? []) as Review[];
  const counts = masteryCounts(deck, reviewList);

  if (cards.isLoading) {
    return (
      <Screen edges={["bottom"]}>
        <SkeletonList rows={2} />
      </Screen>
    );
  }
  if (cards.error) {
    return (
      <Screen edges={["bottom"]}>
        <ErrorState message={errorMessage(cards.error)} onRetry={() => cards.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen edges={["bottom"]}>
      {deck.length === 0 ? (
        <View className="gap-4">
          <EmptyState icon={<Layers size={22} color={theme.primary} />} title="No flashcards yet" body="Make a deck from the transcript: questions on one side, answers on the other." />
          <Button label="Make flashcards" loading={generate.isPending} onPress={() => generate.mutate({ recordingId })} />
        </View>
      ) : (
        <>
          <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: "learn", label: "Learn" }, { value: "test", label: "Test" }]} />
          <Text variant="muted">
            {counts.mastered} mastered · {counts.learning} learning · {counts.fresh} new
          </Text>
          {mode === "learn" ? <Learn recordingId={recordingId} deck={deck} reviews={reviewList} /> : <Test deck={deck} />}
          <Button label="Make a new deck" variant="ghost" loading={generate.isPending} onPress={() => generate.mutate({ recordingId })} />
        </>
      )}
    </Screen>
  );
}

function FlipCard({ card, flipped, onFlip }: { card: Flashcard; flipped: boolean; onFlip: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={flipped ? `Answer: ${card.answer}` : `Question: ${card.question}`}
      accessibilityHint={flipped ? "Shows the question" : "Shows the answer"}
      onPress={() => {
        Haptics.selectionAsync().catch(() => undefined);
        onFlip();
      }}
      className="min-h-[240px] justify-center gap-3 rounded-xl border border-border bg-card p-6 active:bg-muted"
    >
      <Text variant="caption" className={flipped ? "text-primary" : undefined}>
        {flipped ? "Answer" : "Question"}
      </Text>
      <Text variant="heading" className="leading-[28px]">
        {flipped ? card.answer : card.question}
      </Text>
      {!flipped ? <Text variant="caption">Tap to show the answer</Text> : null}
    </Pressable>
  );
}

/** Learn: cards not mastered yet; "I knew it" moves a card on, "Still learning" keeps it in the queue. */
function Learn({ recordingId, deck, reviews }: { recordingId: number; deck: Flashcard[]; reviews: Review[] }) {
  const utils = trpc.useUtils();
  const queue = useMemo(() => learnQueue(deck, reviews), [deck, reviews]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const review = trpc.ai.reviewFlashcard.useMutation({ onSuccess: () => utils.ai.getFlashcardReviews.invalidate({ recordingId }) });

  if (queue.length === 0) return <EmptyState title="Everything is mastered" body="Switch to Test to check yourself on the whole deck." />;
  const card = queue[Math.min(index, queue.length - 1)];
  const current = reviews.find((item) => item.flashcardId === card.id)?.status;

  function answer(knewIt: boolean) {
    Haptics.notificationAsync(knewIt ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    review.mutate({ recordingId, flashcardId: card.id, status: nextStatus(current, knewIt) });
    setFlipped(false);
    setIndex((value) => (value + 1) % Math.max(1, queue.length));
  }

  return (
    <View className="gap-4">
      <ProgressBar value={(index % queue.length) / queue.length} label={`Card ${(index % queue.length) + 1} of ${queue.length}`} />
      <FlipCard card={card} flipped={flipped} onFlip={() => setFlipped((value) => !value)} />
      {flipped ? (
        <View className="flex-row gap-3">
          <Button className="flex-1" label="Still learning" variant="outline" onPress={() => answer(false)} />
          <Button className="flex-1" label="I knew it" onPress={() => answer(true)} />
        </View>
      ) : (
        <Button label="Show answer" variant="secondary" onPress={() => setFlipped(true)} />
      )}
    </View>
  );
}

/** Test: the whole deck shuffled, self-marked, with a score at the end. */
function Test({ deck }: { deck: Flashcard[] }) {
  const [order, setOrder] = useState(() => shuffle(deck));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [right, setRight] = useState(0);

  if (index >= order.length) {
    return (
      <Card className="items-center gap-3 py-8">
        <Text variant="display">
          {right}/{order.length}
        </Text>
        <Text variant="muted">cards you knew</Text>
        <Button label="Test again" onPress={() => (setOrder(shuffle(deck)), setIndex(0), setRight(0), setFlipped(false))} />
      </Card>
    );
  }
  const card = order[index];
  return (
    <View className="gap-4">
      <ProgressBar value={index / order.length} label={`Card ${index + 1} of ${order.length}`} />
      <FlipCard card={card} flipped={flipped} onFlip={() => setFlipped((value) => !value)} />
      {flipped ? (
        <View className="flex-row gap-3">
          <Button className="flex-1" label="Got it wrong" variant="outline" onPress={() => (setIndex(index + 1), setFlipped(false))} />
          <Button className="flex-1" label="Got it right" onPress={() => (setRight(right + 1), setIndex(index + 1), setFlipped(false))} />
        </View>
      ) : (
        <Button label="Show answer" variant="secondary" onPress={() => setFlipped(true)} />
      )}
    </View>
  );
}

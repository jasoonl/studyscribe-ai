import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ListChecks } from "lucide-react-native";
import { QuizRunner, type QuizQuestion, type QuizResult } from "@/components/QuizRunner";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, ListGroup, ListRow, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

export default function QuizScreen() {
  const recordingId = Number(useLocalSearchParams<{ id: string }>().id);
  const theme = useTheme();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [quizId, setQuizId] = useState<number | null>(null);
  const list = trpc.quizzes.list.useQuery({ recordingId });
  const quiz = trpc.quizzes.get.useQuery({ id: quizId ?? 0 }, { enabled: quizId !== null });
  const generate = trpc.quizzes.generate.useMutation({
    onSuccess: async () => {
      const fresh = await utils.quizzes.list.fetch({ recordingId });
      utils.quizzes.list.invalidate({ recordingId });
      const newest = (fresh as { id: number }[])[0];
      if (newest) setQuizId(newest.id);
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });
  const submit = trpc.quizzes.submitAttempt.useMutation();

  const quizzes = (list.data ?? []) as { id: number; title: string; createdAt: Date | string; questions?: unknown[] }[];

  if (quizId !== null) {
    const questions = ((quiz.data as { questions?: QuizQuestion[] } | undefined)?.questions ?? []) as QuizQuestion[];
    return (
      <Screen edges={["bottom"]}>
        <Button label="All quizzes" variant="ghost" size="sm" className="self-start" onPress={() => setQuizId(null)} />
        {quiz.isLoading ? (
          <SkeletonList rows={3} />
        ) : quiz.error ? (
          <ErrorState message={errorMessage(quiz.error)} />
        ) : (
          <>
            <Text variant="title">{(quiz.data as { title?: string })?.title ?? "Quiz"}</Text>
            <QuizRunner key={quizId} questions={questions} submitting={submit.isPending} onSubmit={(answers) => submit.mutateAsync({ quizId, answers }) as Promise<QuizResult>} />
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen edges={["bottom"]}>
      <Button label="Make a 10-question quiz" loading={generate.isPending} onPress={() => generate.mutate({ recordingId, questionCount: 10 })} />
      {generate.isPending ? <Text variant="caption">Writing questions from the transcript. This takes a moment.</Text> : null}
      {list.isLoading ? (
        <SkeletonList rows={2} />
      ) : quizzes.length === 0 ? (
        <EmptyState icon={<ListChecks size={22} color={theme.primary} />} title="No quizzes yet" body="Make one to check what you remember. Answers are marked with explanations." />
      ) : (
        <View className="gap-2">
          <Text variant="label" className="text-muted-foreground">
            Your quizzes
          </Text>
          <ListGroup>
            {quizzes.map((item) => (
              <ListRow key={item.id} title={item.title} subtitle={`${formatDate(item.createdAt)}${item.questions ? ` · ${item.questions.length} questions` : ""}`} onPress={() => setQuizId(item.id)} />
            ))}
          </ListGroup>
        </View>
      )}
    </Screen>
  );
}

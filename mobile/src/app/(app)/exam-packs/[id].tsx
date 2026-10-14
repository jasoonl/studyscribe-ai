import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Markdown } from "@/components/Markdown";
import { QuizRunner, type QuizQuestion, type QuizResult } from "@/components/QuizRunner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, trpc } from "@/lib/trpc";

/** An exam pack: its guide, then its practice exam (made by a second request, as on the web, so neither request makes two model calls). */
export default function ExamPackScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"guide" | "exam">("guide");
  const pack = trpc.examPacks.get.useQuery({ id });
  const generateQuiz = trpc.examPacks.generateQuiz.useMutation({
    onSuccess: () => utils.examPacks.get.invalidate({ id }),
    onError: (error) => toast.show(errorMessage(error), "error"),
  });
  const submit = trpc.examPacks.submitAttempt.useMutation({ onSuccess: () => utils.examPacks.list.invalidate() });
  const remove = trpc.examPacks.remove.useMutation({
    onSuccess: () => {
      utils.examPacks.list.invalidate();
      router.back();
    },
  });
  const asked = useRef(false);

  const data = pack.data as
    | { title: string; guide: string | null; questions: QuizQuestion[] | null; lastScore: number | null; sources: { id: number; title: string; available: boolean }[] }
    | undefined;

  // The practice exam is written right after the guide.
  useEffect(() => {
    if (data && !data.questions?.length && !asked.current && !generateQuiz.isPending) {
      asked.current = true;
      generateQuiz.mutate({ id });
    }
  }, [data, generateQuiz, id]);

  if (pack.isLoading) {
    return (
      <Screen edges={["bottom"]}>
        <SkeletonList rows={4} />
      </Screen>
    );
  }
  if (pack.error || !data) {
    return (
      <Screen edges={["bottom"]}>
        <ErrorState message={pack.error ? errorMessage(pack.error) : "Exam pack not found."} onRetry={() => pack.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen edges={["bottom"]}>
      <Stack.Screen options={{ title: "Exam pack" }} />
      <Text variant="title">{data.title}</Text>
      <View className="flex-row flex-wrap gap-x-2">
        {data.sources.map((source, index) => (
          <Pressable key={source.id} accessibilityRole="link" disabled={!source.available} onPress={() => router.push(`/recording/${source.id}`)}>
            <Text variant="small" className={source.available ? "text-primary" : "text-muted-foreground"}>
              {source.title}
              {index < data.sources.length - 1 ? "," : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <Segmented label="Exam pack sections" value={tab} onChange={setTab} options={[{ value: "guide", label: "Study guide" }, { value: "exam", label: "Practice exam" }]} />
      {tab === "guide" ? (
        <Card>{data.guide ? <Markdown source={data.guide} /> : <Text variant="muted">The guide is still being written.</Text>}</Card>
      ) : data.questions?.length ? (
        <>
          {data.lastScore !== null ? <Text variant="muted">Last score: {data.lastScore}%</Text> : null}
          <QuizRunner key={data.questions.length} questions={data.questions} submitting={submit.isPending} onSubmit={(answers) => submit.mutateAsync({ id, answers }) as Promise<QuizResult>} />
        </>
      ) : (
        <Card className="gap-3">
          <Text variant="muted">{generateQuiz.isPending ? "Writing the practice exam. This can take up to a minute." : "No practice exam yet."}</Text>
          {!generateQuiz.isPending ? <Button label="Write the practice exam" onPress={() => generateQuiz.mutate({ id })} /> : null}
        </Card>
      )}
      <Button
        label="Delete exam pack"
        variant="ghost"
        onPress={() =>
          Alert.alert("Delete this exam pack?", undefined, [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => remove.mutate({ id }) },
          ])
        }
      />
    </Screen>
  );
}

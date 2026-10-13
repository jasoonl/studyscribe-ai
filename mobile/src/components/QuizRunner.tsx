import { useState } from "react";
import { Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Check, X } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/tokens";

export type QuizQuestion = {
  id: string;
  question: string;
  type: "multiple-choice" | "short-answer";
  options?: string[];
  correctAnswer: string;
  explanation: string;
};

export type QuizResult = { score: number; correct: number; total: number; results?: { id: string; correct: boolean }[] };

/** Same comparison the server uses for recording quizzes: case and surrounding space ignored. */
export function locallyCorrect(question: QuizQuestion, answer: string | undefined) {
  return Boolean(answer && answer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase());
}

/** Answers every question, then submits once and shows the score with explanations. Grading happens on the server. */
export function QuizRunner({ questions, onSubmit, submitting }: { questions: QuizQuestion[]; onSubmit: (answers: Record<string, string>) => Promise<QuizResult>; submitting: boolean }) {
  const theme = useTheme();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const answered = questions.filter((question) => answers[question.id]?.trim()).length;

  async function submit() {
    const outcome = await onSubmit(answers);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setResult(outcome);
  }

  const correctFor = (question: QuizQuestion) => result?.results?.find((item) => item.id === question.id)?.correct ?? locallyCorrect(question, answers[question.id]);

  return (
    <View className="gap-4">
      {result ? (
        <Card className="items-center gap-1 py-6" accessibilityLiveRegion="polite">
          <Text variant="display">{result.score}%</Text>
          <Text variant="muted">
            {result.correct} of {result.total} correct
          </Text>
          <Button label="Try again" variant="outline" size="sm" className="mt-3" onPress={() => (setAnswers({}), setResult(null))} />
        </Card>
      ) : null}
      {questions.map((question, number) => {
        const chosen = answers[question.id];
        const correct = result ? correctFor(question) : null;
        return (
          <Card key={question.id} className="gap-3">
            <Text variant="caption">Question {number + 1}</Text>
            <Text variant="subheading">{question.question}</Text>
            {question.type === "multiple-choice" && question.options?.length ? (
              <View className="gap-2" accessibilityRole="radiogroup">
                {question.options.map((option) => {
                  const selected = chosen === option;
                  const isAnswer = result && option.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: !!result }}
                      accessibilityLabel={`${option}${isAnswer ? ", correct answer" : ""}`}
                      disabled={!!result}
                      onPress={() => setAnswers({ ...answers, [question.id]: option })}
                      className={cn(
                        "min-h-[48px] flex-row items-center gap-3 rounded-lg border px-3 py-2.5",
                        isAnswer ? "border-course-green bg-course-green/10" : selected ? (result ? "border-destructive bg-destructive/5" : "border-primary bg-secondary") : "border-border bg-card",
                      )}
                    >
                      <View className={cn("h-5 w-5 items-center justify-center rounded-full border-2", selected ? "border-primary" : "border-input")}>
                        {selected ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                      </View>
                      <Text variant="body" className="flex-1">
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Input value={chosen ?? ""} onChangeText={(text) => setAnswers({ ...answers, [question.id]: text })} editable={!result} placeholder="Your answer" accessibilityLabel={`Answer to question ${number + 1}`} />
            )}
            {result ? (
              <View className="gap-1.5 rounded-lg bg-muted p-3">
                <View className="flex-row items-center gap-2">
                  {correct ? <Check size={16} color={theme.success} /> : <X size={16} color={theme.destructive} />}
                  <Text variant="label">{correct ? "Correct" : `Answer: ${question.correctAnswer}`}</Text>
                </View>
                {question.explanation ? <Text variant="small">{question.explanation}</Text> : null}
              </View>
            ) : null}
          </Card>
        );
      })}
      {!result ? <Button label={`Submit (${answered}/${questions.length} answered)`} loading={submitting} disabled={answered === 0} onPress={submit} haptic /> : null}
    </View>
  );
}

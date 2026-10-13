import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { resolveCourseColor } from "@shared/courseColors";
import { ChatThread, type ChatMessage } from "@/components/ChatThread";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { formatTimestamp } from "@/lib/format";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

type Citation = { n: number; recordingId: number; title: string; start: number | null; snippet: string };
type Exchange = { id: number; question: string; answer?: string; citations?: Citation[]; failed?: boolean };

/** Ask StudyScribe: one question across all recordings (or one course), answered with numbered citations that open the moment. */
export default function AskScreen() {
  const theme = useTheme();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [courseId, setCourseId] = useState<number | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const courses = trpc.courses.list.useQuery(undefined, { retry: false });
  const ask = trpc.ai.askAcrossRecordings.useMutation();
  const courseList = ((courses.data ?? []) as { id: number; name: string; color: string | null; archived?: unknown }[]).filter((course) => !course.archived);

  async function send() {
    const question = draft.trim();
    if (question.length < 2) return;
    setDraft("");
    const id = Date.now();
    const history = exchanges
      .filter((exchange) => exchange.answer)
      .slice(-4)
      .flatMap((exchange) => [
        { role: "user" as const, content: exchange.question },
        { role: "assistant" as const, content: exchange.answer! },
      ]);
    setExchanges((current) => [...current, { id, question }]);
    try {
      const result = (await ask.mutateAsync({ question, courseId: courseId ?? undefined, history })) as { answer: string; citations: Citation[] };
      setExchanges((current) => current.map((exchange) => (exchange.id === id ? { ...exchange, answer: result.answer, citations: result.citations } : exchange)));
    } catch (error) {
      toast.show(errorMessage(error), "error");
      setExchanges((current) => current.map((exchange) => (exchange.id === id ? { ...exchange, failed: true, answer: "That question could not be answered. Try again in a moment." } : exchange)));
    }
  }

  const messages: ChatMessage[] = exchanges.flatMap((exchange) => {
    const list: ChatMessage[] = [{ id: `${exchange.id}-q`, role: "user", content: exchange.question }];
    if (exchange.answer) {
      list.push({
        id: `${exchange.id}-a`,
        role: "assistant",
        content: exchange.answer,
        footer: exchange.citations?.length ? (
          <View className="gap-2 border-t border-border pt-2">
            {exchange.citations.map((citation) => (
              <Pressable
                key={citation.n}
                accessibilityRole="link"
                accessibilityLabel={`Source ${citation.n}: ${citation.title}${citation.start !== null ? ` at ${formatTimestamp(citation.start)}` : ""}`}
                onPress={() => router.push(`/recording/${citation.recordingId}${citation.start !== null ? `?t=${Math.floor(citation.start)}` : ""}` as never)}
                className="gap-0.5 rounded-lg bg-muted px-3 py-2 active:opacity-80"
              >
                <Text variant="caption" className="text-primary">
                  [{citation.n}] {citation.title}
                  {citation.start !== null ? ` · ${formatTimestamp(citation.start)}` : ""}
                </Text>
                <Text variant="caption" numberOfLines={2}>
                  {citation.snippet}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : undefined,
      });
    }
    return list;
  });

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <View className="gap-3 px-4 pb-2 pt-3">
        <Text variant="display">Ask</Text>
        {courseList.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" accessibilityLabel="Search in">
            {[{ id: null as number | null, name: "All recordings", color: null as string | null }, ...courseList].map((course) => (
              <Pressable
                key={course.id ?? "all"}
                accessibilityRole="button"
                accessibilityState={{ selected: courseId === course.id }}
                onPress={() => setCourseId(course.id)}
                className={cn("min-h-[34px] flex-row items-center gap-2 rounded-full border px-3", courseId === course.id ? "border-primary bg-secondary" : "border-border bg-card")}
              >
                {course.color ? <View className="h-2 w-2 rounded-full" style={{ backgroundColor: theme.course[resolveCourseColor(course.color)] }} /> : null}
                <Text variant="caption" className="text-foreground">
                  {course.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
      <ChatThread
        messages={messages}
        draft={draft}
        onDraft={setDraft}
        onSend={send}
        sending={ask.isPending}
        placeholder="Ask about anything you recorded"
        bottomInset={false}
        empty={
          <View className="gap-2 rounded-xl border border-dashed border-border p-5">
            <Text variant="subheading">Search everything you've recorded</Text>
            <Text variant="muted">Answers quote your transcripts and link to the moment it was said. Try "What did the lecturer say about osmosis?"</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

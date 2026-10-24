import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { resolveCourseColor } from "@shared/courseColors";
import { ChatThread, type ChatMessage } from "@/components/ChatThread";
import { AskSourcePicker, pickerChipText } from "@/components/sources/AskSourcePicker";
import { pruneSelection } from "@/components/sources/detailModel";
import { SourceCitations } from "@/components/sources/SourceCitations";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { askRequestOptions, emptySelection, type AskSourceSelection } from "@/lib/sources/askSources";
import { useSourcesAvailable } from "@/lib/sources/useSourcesAvailable";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

type Citation = { n: number; recordingId: number; title: string; start: number | null; snippet: string; sourceId?: number; location?: string; unitIndex?: number };
type Meta = { askedSources: boolean; searched: number; searchedSources?: number };
type Exchange = { id: number; question: string; answer?: string; citations?: Citation[]; meta?: Meta; failed?: boolean };

/** Ask StudyScribe: one question across all recordings (or one course), answered with numbered citations that open the moment. */
export default function AskScreen() {
  const theme = useTheme();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [courseId, setCourseId] = useState<number | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const courses = trpc.courses.list.useQuery(undefined, { retry: false });
  const ask = trpc.ai.askAcrossRecordings.useMutation();
  const [chosen, setSelection] = useState<AskSourceSelection>(emptySelection);
  const [pickerOpen, setPickerOpen] = useState(false);
  // With no ready source in scope the screen behaves exactly as it did before study sources existed.
  const sourceInfo = useSourcesAvailable(courseId ?? undefined);
  const readySources = sourceInfo.available ? sourceInfo.sources.filter((source) => source.status === "ready") : [];
  const hasSources = readySources.length > 0;
  // Derived, not stored: a source deleted elsewhere drops out of the selection on the next render.
  const selection = pruneSelection(chosen, readySources.map((source) => source.id));
  useEffect(() => {
    setSelection((current) => ({ ids: [], mode: current.mode }));
  }, [courseId]);
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
      const options: Partial<ReturnType<typeof askRequestOptions>> = hasSources ? askRequestOptions(selection) : {};
      const result = (await ask.mutateAsync({ question, courseId: courseId ?? undefined, history, ...options })) as { answer: string; citations: Citation[]; searched?: number; searchedSources?: number };
      const meta: Meta | undefined = hasSources
        ? { askedSources: options.includeSources ?? true, searched: result.searched ?? 0, searchedSources: result.searchedSources }
        : undefined;
      setExchanges((current) => current.map((exchange) => (exchange.id === id ? { ...exchange, answer: result.answer, citations: result.citations, meta } : exchange)));
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
        footer: exchange.citations?.length || exchange.meta ? <SourceCitations citations={exchange.citations ?? []} meta={exchange.meta} /> : undefined,
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
        {hasSources ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Using: ${pickerChipText(selection, readySources.length)}. Change what Ask searches.`}
            onPress={() => setPickerOpen(true)}
            hitSlop={{ top: 6, bottom: 6 }}
            className="min-h-[44px] flex-row items-center gap-2 self-start rounded-full border border-border bg-card px-4 active:bg-secondary"
          >
            <Text variant="caption" className="text-muted-foreground">
              Using
            </Text>
            <Text variant="label">{pickerChipText(selection, readySources.length)}</Text>
          </Pressable>
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
            <Text variant="subheading">{hasSources ? "Search everything you've recorded or uploaded" : "Search everything you've recorded"}</Text>
            <Text variant="muted">
              {hasSources
                ? 'Answers quote your transcripts and uploaded notes, and link to the moment or page they came from. Try "What did the lecturer say about osmosis?"'
                : 'Answers quote your transcripts and link to the moment it was said. Try "What did the lecturer say about osmosis?"'}
            </Text>
          </View>
        }
      />
      {hasSources ? <AskSourcePicker open={pickerOpen} onClose={() => setPickerOpen(false)} sources={readySources} selection={selection} onChange={setSelection} /> : null}
    </SafeAreaView>
  );
}

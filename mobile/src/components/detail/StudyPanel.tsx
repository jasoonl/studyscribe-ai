import { View } from "react-native";
import { router } from "expo-router";
import { BookOpen, GraduationCap, ListChecks, Mail, MessagesSquare, Layers, ListTree, Tags } from "lucide-react-native";
import { Button } from "@/components/ui/Button";
import { SectionTitle } from "@/components/ui/Card";
import { ListGroup, ListRow } from "@/components/ui/misc";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

/** The study tools for one recording, each on its own screen, plus key terms and chapters. */
export function StudyPanel({ recordingId, hasKeyTerms, hasChapters }: { recordingId: number; hasKeyTerms: boolean; hasChapters: boolean }) {
  const theme = useTheme();
  const toast = useToast();
  const utils = trpc.useUtils();
  const onDone = (what: string) => () => {
    utils.insights.get.invalidate({ recordingId });
    toast.show(`${what} ready.`, "success");
  };
  const keyTerms = trpc.insights.generateKeyTerms.useMutation({ onSuccess: onDone("Key terms"), onError: (error) => toast.show(errorMessage(error), "error") });
  const chapters = trpc.insights.generateChapters.useMutation({ onSuccess: onDone("Chapters"), onError: (error) => toast.show(errorMessage(error), "error") });
  const icon = (Icon: typeof BookOpen) => <Icon size={18} color={theme.primary} />;
  const open = (path: string) => () => router.push(path as never);

  return (
    <View className="gap-1">
      <ListGroup>
        <ListRow title="Flashcards" subtitle="Learn and test with spaced review" icon={icon(Layers)} onPress={open(`/recording/${recordingId}/flashcards`)} />
        <ListRow title="Quiz" subtitle="Multiple choice and short answer" icon={icon(ListChecks)} onPress={open(`/recording/${recordingId}/quiz`)} />
        <ListRow title="Study guide" subtitle="Everything to revise, in order" icon={icon(GraduationCap)} onPress={open(`/recording/${recordingId}/guide`)} />
        <ListRow title="AI tutor" subtitle="Ask questions about this recording" icon={icon(MessagesSquare)} onPress={open(`/recording/${recordingId}/tutor`)} />
        <ListRow title="Email drafts" subtitle="Summaries and follow-ups to send" icon={icon(Mail)} onPress={open(`/recording/${recordingId}/drafts`)} />
      </ListGroup>

      <SectionTitle>Outline</SectionTitle>
      <View className="gap-3 rounded-xl border border-border bg-card p-4">
        <View className="flex-row items-start gap-3">
          {icon(Tags)}
          <View className="flex-1 gap-1">
            <Text variant="subheading">Key terms</Text>
            <Text variant="muted">The terms that matter most, shown above the transcript. Tap one to find it.</Text>
          </View>
        </View>
        <Button label={hasKeyTerms ? "Find key terms again" : "Find key terms"} variant="outline" size="sm" loading={keyTerms.isPending} onPress={() => keyTerms.mutate({ recordingId })} />
        <View className="h-px bg-border" />
        <View className="flex-row items-start gap-3">
          {icon(ListTree)}
          <View className="flex-1 gap-1">
            <Text variant="subheading">Chapters</Text>
            <Text variant="muted">Splits the recording into titled sections under the player, each a tap to jump to.</Text>
          </View>
        </View>
        <Button label={hasChapters ? "Make chapters again" : "Make chapters"} variant="outline" size="sm" loading={chapters.isPending} onPress={() => chapters.mutate({ recordingId })} />
      </View>
      <View className="h-2" />
      <Button label="Open Ask StudyScribe" variant="ghost" icon={icon(BookOpen)} onPress={() => router.push("/ask")} />
    </View>
  );
}

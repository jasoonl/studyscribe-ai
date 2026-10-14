import { useState } from "react";
import { Pressable, Share, View } from "react-native";
import { Share2 } from "lucide-react-native";
import { NOTE_TEMPLATES, type NoteTemplateId } from "@shared/noteTemplates";
import { Markdown } from "@/components/Markdown";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/misc";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

const TYPE_LABELS: Record<string, string> = {
  summary: "Summary",
  key_concepts: "Key concepts",
  action_items: "Action items",
  formulas: "Formulas",
  study_guide: "Study guide",
};

/** AI notes from note templates (shared/noteTemplates.ts), the same presets as the web. */
export function NotesPanel({ recordingId, title }: { recordingId: number; title: string }) {
  const theme = useTheme();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [template, setTemplate] = useState<NoteTemplateId>("lecture");
  const notes = trpc.ai.getStudyNotes.useQuery({ recordingId });
  const generate = trpc.ai.generateStudyNotes.useMutation({
    onSuccess: () => {
      utils.ai.getStudyNotes.invalidate({ recordingId });
      toast.show("Notes ready.", "success");
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  const list = (notes.data ?? []) as { id: number; type: string; content: string; metadata?: unknown; createdAt?: Date | string }[];

  return (
    <View className="gap-4">
      <Card className="gap-3">
        <Text variant="subheading">Generate notes</Text>
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup" accessibilityLabel="Note template">
          {NOTE_TEMPLATES.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: template === option.id }}
              accessibilityLabel={`${option.label}. ${option.description}`}
              onPress={() => setTemplate(option.id)}
              className={cn("rounded-full border px-3 py-1.5", template === option.id ? "border-primary bg-secondary" : "border-border bg-card")}
            >
              <Text variant="caption" className="text-foreground">
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text variant="muted">{NOTE_TEMPLATES.find((option) => option.id === template)?.description}</Text>
        <Button label="Generate notes" loading={generate.isPending} onPress={() => generate.mutate({ recordingId, template })} />
        {generate.isPending ? <Text variant="caption">This takes up to a minute for a long lecture.</Text> : null}
      </Card>

      {notes.isLoading ? (
        <SkeletonList rows={2} />
      ) : notes.error ? (
        <ErrorState message={errorMessage(notes.error)} onRetry={() => notes.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title="No notes yet" body="Pick a template above to turn the transcript into notes." />
      ) : (
        list.map((note) => {
          const templateId = (note.metadata as { template?: string } | null)?.template;
          const label = NOTE_TEMPLATES.find((option) => option.id === templateId)?.label ?? TYPE_LABELS[note.type] ?? "Notes";
          return (
            <Card key={note.id} className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text variant="label" className="text-primary">
                  {label}
                </Text>
                <IconButton label={`Share ${label}`} onPress={() => Share.share({ title, message: `${title}: ${label}\n\n${note.content}` })} icon={<Share2 size={18} color={theme.mutedForeground} />} />
              </View>
              <Markdown source={note.content} />
            </Card>
          );
        })
      )}
    </View>
  );
}

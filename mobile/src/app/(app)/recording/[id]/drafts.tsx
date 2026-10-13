import { useState } from "react";
import { Share, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, SkeletonList } from "@/components/ui/misc";
import { Screen } from "@/components/ui/Screen";
import { Segmented } from "@/components/ui/Segmented";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, trpc } from "@/lib/trpc";

type DraftType = "email-summary" | "document" | "report";
type Tone = "formal" | "casual" | "technical" | "persuasive";

export default function EmailDraftsScreen() {
  const recordingId = Number(useLocalSearchParams<{ id: string }>().id);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [draftType, setDraftType] = useState<DraftType>("email-summary");
  const [tone, setTone] = useState<Tone>("formal");
  const list = trpc.emailDrafts.list.useQuery({ recordingId });
  const generate = trpc.emailDrafts.generate.useMutation({
    onSuccess: () => utils.emailDrafts.list.invalidate({ recordingId }),
    onError: (error) => toast.show(errorMessage(error), "error"),
  });
  const drafts = ((list.data ?? []) as { id: number; title: string; subject: string; content: string; status?: string | null }[]).filter((draft) => draft.status !== "failed");

  return (
    <Screen edges={["bottom"]}>
      <Card className="gap-3">
        <Text variant="subheading">New draft</Text>
        <Segmented label="Kind of draft" value={draftType} onChange={setDraftType} options={[{ value: "email-summary", label: "Email" }, { value: "document", label: "Document" }, { value: "report", label: "Report" }]} />
        <Segmented label="Tone" value={tone} onChange={setTone} options={[{ value: "formal", label: "Formal" }, { value: "casual", label: "Casual" }, { value: "technical", label: "Technical" }, { value: "persuasive", label: "Persuasive" }]} />
        <Button label="Write draft" loading={generate.isPending} onPress={() => generate.mutate({ recordingId, draftType, tone })} />
      </Card>
      {list.isLoading ? (
        <SkeletonList rows={2} />
      ) : drafts.length === 0 ? (
        <EmptyState title="No drafts yet" body="Write a summary email to send to classmates or a team after the meeting." />
      ) : (
        drafts.map((draft) => (
          <Card key={draft.id} className="gap-3">
            <Text variant="caption">Subject</Text>
            <Text variant="subheading" selectable>
              {draft.subject}
            </Text>
            <View className="h-px bg-border" />
            <Markdown source={draft.content} />
            <View className="flex-row gap-2">
              <Button className="flex-1" size="sm" label="Share" onPress={() => Share.share({ title: draft.subject, message: `${draft.subject}\n\n${draft.content}` })} />
              <Button className="flex-1" size="sm" variant="outline" label="Copy" onPress={() => Clipboard.setStringAsync(`${draft.subject}\n\n${draft.content}`).then(() => toast.show("Copied.", "success"))} />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

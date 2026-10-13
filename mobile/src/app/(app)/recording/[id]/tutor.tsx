import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ChatThread, type ChatMessage } from "@/components/ChatThread";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, trpc } from "@/lib/trpc";

/** AI tutor: questions about this one recording, with the conversation kept on the server. */
export default function TutorScreen() {
  const recordingId = Number(useLocalSearchParams<{ id: string }>().id);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const history = trpc.ai.getChatHistory.useQuery({ recordingId });
  const send = trpc.ai.assistantChat.useMutation({
    onSettled: () => {
      setPending(null);
      utils.ai.getChatHistory.invalidate({ recordingId });
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  const messages: ChatMessage[] = ((history.data ?? []) as { id: number; role: "user" | "assistant"; content: string }[]).map((message) => ({ id: message.id, role: message.role, content: message.content }));
  if (pending) messages.push({ id: "pending", role: "user", content: pending });

  return (
    <ChatThread
      messages={messages}
      draft={draft}
      onDraft={setDraft}
      sending={send.isPending}
      placeholder="Ask about this recording"
      onSend={() => {
        const message = draft.trim();
        if (!message) return;
        setDraft("");
        setPending(message);
        send.mutate({ recordingId, message });
      }}
      empty={
        <View className="gap-2 rounded-xl border border-dashed border-border p-5">
          <Text variant="subheading">Ask the tutor</Text>
          <Text variant="muted">It answers from this recording's transcript. Try "Explain the main argument simply" or "What might be on the exam?"</Text>
        </View>
      }
    />
  );
}

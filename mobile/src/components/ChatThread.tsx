import { useEffect, useRef, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowUp } from "lucide-react-native";
import { Markdown } from "@/components/Markdown";
import { IconButton } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/tokens";

export type ChatMessage = { id: string | number; role: "user" | "assistant"; content: string; footer?: ReactNode };

/** A conversation with a composer pinned above the keyboard (AI tutor, Ask StudyScribe). */
export function ChatThread({
  messages,
  draft,
  onDraft,
  onSend,
  sending,
  placeholder,
  empty,
  header,
  bottomInset = true,
}: {
  messages: ChatMessage[];
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  placeholder: string;
  empty?: ReactNode;
  header?: ReactNode;
  /** Off inside a tab, where the tab bar already covers the bottom inset. */
  bottomInset?: boolean;
}) {
  const theme = useTheme();
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(timer);
  }, [messages.length, sending]);

  return (
    <SafeAreaView edges={bottomInset ? ["bottom"] : []} className="flex-1 bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? (bottomInset ? 100 : 0) : 0} className="flex-1">
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerClassName="w-full max-w-[720px] self-center gap-3 px-4 py-4">
          {header}
          {messages.length === 0 && !sending ? empty : null}
          {messages.map((message) => (
            <View
              key={message.id}
              accessible
              accessibilityLabel={`${message.role === "user" ? "You" : "StudyScribe"}: ${message.content}`}
              className={cn("max-w-[88%] gap-2 rounded-xl px-4 py-3", message.role === "user" ? "self-end bg-primary" : "self-start border border-border bg-card")}
            >
              {message.role === "user" ? (
                <Text variant="body" className="text-primary-foreground">
                  {message.content}
                </Text>
              ) : (
                <Markdown source={message.content} />
              )}
              {message.footer}
            </View>
          ))}
          {sending ? (
            <View className="self-start rounded-xl border border-border bg-card px-4 py-3" accessibilityLabel="Thinking" accessible>
              <Text variant="muted">Thinking…</Text>
            </View>
          ) : null}
        </ScrollView>
        <View className="flex-row items-end gap-2 border-t border-border bg-background px-3 py-2">
          <TextInput
            value={draft}
            onChangeText={onDraft}
            placeholder={placeholder}
            placeholderTextColor={theme.mutedForeground}
            accessibilityLabel={placeholder}
            multiline
            maxLength={1000}
            maxFontSizeMultiplier={1.6}
            className="max-h-[120px] min-h-[44px] flex-1 rounded-lg border border-input bg-card px-3.5 py-2.5 font-sans text-[16px] text-foreground"
          />
          <IconButton label="Send" disabled={!draft.trim() || sending} onPress={onSend} className="mb-0.5 h-11 w-11 bg-primary" icon={<ArrowUp size={20} color={theme.primaryForeground} />} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

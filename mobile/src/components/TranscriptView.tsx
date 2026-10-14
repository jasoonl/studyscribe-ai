import { useMemo, useState } from "react";
import { Pressable, Share, View } from "react-native";
import { ChevronDown, ChevronUp, Pencil, Search, Share2 } from "lucide-react-native";
import { usePlayer } from "@/components/AudioPlayer";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";
import { Text } from "@/components/ui/Text";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { formatTimestamp } from "@/lib/format";
import { activeSegmentIndex, findMatches, transcriptAsText, type Segment } from "@/lib/transcript";
import { errorMessage, trpc } from "@/lib/trpc";
import { useTheme } from "@/theme/tokens";

export type { Segment } from "@/lib/transcript";

const SPEAKER_TONES = ["text-course-blue", "text-course-teal", "text-course-violet", "text-course-amber", "text-course-rose", "text-course-green"];

/**
 * Transcript with speakers: tap a line to play from there, the playing line
 * is highlighted, search steps through matches, long press a speaker to
 * rename them (renaming to an existing name merges the two).
 */
export function TranscriptView({
  recordingId,
  title,
  segments,
  fullText,
  canEdit,
  keyTerms,
  initialQuery,
}: {
  recordingId: number;
  title: string;
  segments: Segment[];
  fullText: string;
  canEdit: boolean;
  keyTerms?: string[];
  initialQuery?: string;
}) {
  const theme = useTheme();
  const toast = useToast();
  const player = usePlayer();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [matchIndex, setMatchIndex] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fullText);

  const rename = trpc.transcription.renameSpeaker.useMutation({
    onSuccess: () => {
      utils.transcription.get.invalidate({ recordingId });
      setRenaming(null);
      toast.show("Speaker renamed.", "success");
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });
  const update = trpc.transcription.update.useMutation({
    onSuccess: () => {
      utils.transcription.get.invalidate({ recordingId });
      setEditing(false);
      toast.show("Transcript saved.", "success");
    },
    onError: (error) => toast.show(errorMessage(error), "error"),
  });

  const speakers = useMemo(() => [...new Set(segments.map((segment) => segment.speaker).filter(Boolean) as string[])], [segments]);
  const matches = useMemo(() => findMatches(segments, query), [segments, query]);
  const current = matches.length ? matches[Math.min(matchIndex, matches.length - 1)] : -1;
  const active = player ? activeSegmentIndex(segments, player.currentTime) : -1;
  const edited = segments.length > 0 && segments.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").trim() !== fullText.replace(/\s+/g, " ").trim();

  function step(direction: 1 | -1) {
    if (!matches.length) return;
    const next = (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(next);
    player?.seek(segments[matches[next]].start);
  }

  return (
    <View className="gap-4">
      <View className="flex-row items-center gap-2">
        <View className="relative flex-1 justify-center">
          <Input value={query} onChangeText={(text) => (setQuery(text), setMatchIndex(0))} placeholder="Search the transcript" accessibilityLabel="Search the transcript" style={{ paddingLeft: 40 }} returnKeyType="search" />
          <View pointerEvents="none" className="absolute left-3.5">
            <Search size={18} color={theme.mutedForeground} />
          </View>
        </View>
        <IconButton label="Share transcript as text" onPress={() => Share.share({ title, message: transcriptAsText(title, segments, fullText) })} icon={<Share2 size={20} color={theme.foreground} />} />
        {canEdit ? <IconButton label="Edit transcript" onPress={() => (setDraft(fullText), setEditing(true))} icon={<Pencil size={20} color={theme.foreground} />} /> : null}
      </View>

      {query.trim().length >= 2 ? (
        <View className="flex-row items-center justify-between rounded-lg bg-muted px-3 py-1.5">
          <Text variant="small" accessibilityLiveRegion="polite">
            {matches.length ? `${Math.min(matchIndex, matches.length - 1) + 1} of ${matches.length} matches` : "No matches"}
          </Text>
          <View className="flex-row">
            <IconButton label="Previous match" disabled={!matches.length} onPress={() => step(-1)} icon={<ChevronUp size={20} color={theme.foreground} />} />
            <IconButton label="Next match" disabled={!matches.length} onPress={() => step(1)} icon={<ChevronDown size={20} color={theme.foreground} />} />
          </View>
        </View>
      ) : null}

      {keyTerms?.length ? (
        <View className="flex-row flex-wrap gap-2" accessibilityLabel="Key terms">
          {keyTerms.map((term) => (
            <Pressable
              key={term}
              accessibilityRole="button"
              accessibilityLabel={`Key term ${term}`}
              accessibilityHint="Searches the transcript for it"
              onPress={() => (setQuery(term), setMatchIndex(0))}
              className={cn("rounded-full border px-3 py-1.5", query === term ? "border-primary bg-secondary" : "border-border bg-card")}
            >
              <Text variant="caption" className="text-foreground">
                {term}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {segments.length === 0 || edited ? (
        <View className="gap-2">
          {edited ? <Text variant="caption">Edited text. Timestamps refer to the original transcript.</Text> : null}
          <Text variant="body" selectable>
            {fullText}
          </Text>
        </View>
      ) : (
        <View className="gap-1">
          {segments.map((segment, index) => {
            const speakerTone = segment.speaker ? SPEAKER_TONES[speakers.indexOf(segment.speaker) % SPEAKER_TONES.length] : "text-muted-foreground";
            const isMatch = index === current;
            return (
              <Pressable
                key={segment.id ?? index}
                accessibilityRole="button"
                accessibilityLabel={`${segment.speaker ?? "Speaker"} at ${formatTimestamp(segment.start)}: ${segment.text}`}
                accessibilityHint={canEdit ? "Plays from here. Long press to rename the speaker" : "Plays from here"}
                onPress={() => player?.seek(segment.start, true)}
                onLongPress={canEdit && segment.speaker ? () => (setRenaming(segment.speaker!), setNewName(segment.speaker!)) : undefined}
                className={cn("gap-1 rounded-lg px-3 py-2.5 active:bg-muted", index === active && "bg-annotation/60", isMatch && "border border-ring")}
              >
                <View className="flex-row items-center gap-2">
                  {segment.speaker ? (
                    <Text variant="label" className={cn("font-semibold", speakerTone)}>
                      {segment.speaker}
                    </Text>
                  ) : null}
                  <Text variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
                    {formatTimestamp(segment.start)}
                  </Text>
                </View>
                <Text variant="body" selectable>
                  {segment.text}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Sheet
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename speaker"
        description="Every line by this speaker changes. Use a name that already exists to merge the two."
        footer={<Button label="Save name" loading={rename.isPending} disabled={!newName.trim()} onPress={() => renaming && rename.mutate({ recordingId, from: renaming, to: newName.trim() })} />}
      >
        <Input label="Name" value={newName} onChangeText={setNewName} autoFocus maxLength={60} />
      </Sheet>

      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit transcript"
        description="Fix names and words the transcription got wrong. Study tools use the edited text."
        footer={<Button label="Save transcript" loading={update.isPending} disabled={!draft.trim()} onPress={() => update.mutate({ recordingId, fullText: draft })} />}
      >
        <Input value={draft} onChangeText={setDraft} multiline accessibilityLabel="Transcript text" style={{ minHeight: 280 }} />
      </Sheet>
    </View>
  );
}

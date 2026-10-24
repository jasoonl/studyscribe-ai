import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { FileText } from "lucide-react-native";
import { Text } from "@/components/ui/Text";
import { citationLink, type AskCitation } from "@/lib/sources/askSources";
import { formatLocation } from "@/lib/sources/location";
import { formatTimestamp } from "@/lib/format";
import { useTheme } from "@/theme/tokens";
import { searchedLine, sourceCitationLabel } from "./detailModel";

export type AnswerMeta = { askedSources: boolean; searched: number; searchedSources?: number };

/**
 * Citations under an Ask answer. A recording citation is exactly what Ask showed before; a study
 * source citation opens the source at its page with the passage highlighted.
 */
export function SourceCitations({ citations, meta }: { citations: AskCitation[]; meta?: AnswerMeta }) {
  const theme = useTheme();
  const line = meta ? searchedLine(meta) : null;
  if (!citations.length && !line) return null;
  return (
    <View className="gap-2 border-t border-border pt-2">
      {citations.map((citation) => {
        if (!citation.sourceId) {
          return (
            <Pressable
              key={citation.n}
              accessibilityRole="link"
              accessibilityLabel={`Source ${citation.n}: ${citation.title}${citation.start !== null ? ` at ${formatTimestamp(citation.start)}` : ""}`}
              onPress={() => router.push(citationLink(citation) as never)}
              className="min-h-[44px] justify-center gap-0.5 rounded-lg bg-muted px-3 py-2 active:bg-secondary"
            >
              <Text variant="caption" className="text-primary">
                [{citation.n}] {citation.title}
                {citation.start !== null ? ` · ${formatTimestamp(citation.start)}` : ""}
              </Text>
              <Text variant="caption" numberOfLines={2}>
                {citation.snippet}
              </Text>
            </Pressable>
          );
        }
        const place = formatLocation(citation.location);
        return (
          <Pressable
            key={citation.n}
            accessibilityRole="link"
            accessibilityLabel={sourceCitationLabel(citation.n, citation.title, place)}
            onPress={() => router.push(citationLink(citation) as never)}
            className="min-h-[44px] justify-center gap-0.5 rounded-lg bg-muted px-3 py-2 active:bg-secondary"
          >
            <View className="flex-row items-center gap-1.5">
              <FileText size={14} color={theme.primary} />
              <Text variant="caption" className="flex-1 text-primary">
                [{citation.n}] {citation.title}
                {place ? `, ${place}` : ""}
              </Text>
            </View>
            <Text variant="caption" numberOfLines={2}>
              {citation.snippet}
            </Text>
          </Pressable>
        );
      })}
      {line ? <Text variant="caption">{line}</Text> : null}
    </View>
  );
}

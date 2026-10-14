import { View } from "react-native";
import { Text } from "@/components/ui/Text";

/**
 * Renders the Markdown the AI tools write (headings, bullets, numbered lists,
 * bold, inline code) as native text. Deliberately small: no tables, images or
 * links, which the prompts do not produce.
 */
export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string; depth: number }
  | { kind: "numbered"; text: string; number: string }
  | { kind: "paragraph"; text: string }
  | { kind: "rule" };

export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    const bullet = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
    } else if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
    } else if (bullet) {
      flush();
      blocks.push({ kind: "bullet", text: bullet[2], depth: Math.min(2, Math.floor(bullet[1].length / 2)) });
    } else if (numbered) {
      flush();
      blocks.push({ kind: "numbered", text: numbered[2], number: numbered[1] });
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

/** Splits **bold** and `code` runs out of a line. */
export function inlineRuns(text: string): { text: string; bold?: boolean; code?: boolean }[] {
  const runs: { text: string; bold?: boolean; code?: boolean }[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) runs.push({ text: text.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith("`")) runs.push({ text: token.slice(1, -1), code: true });
    else runs.push({ text: token.slice(2, -2), bold: true });
    last = match.index! + token.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.map((run) => ({ ...run, text: run.text.replace(/(^|\s)\*([^*]+)\*(?=\s|$|[.,;:])/g, "$1$2") }));
}

function Inline({ text, variant = "body" as const }: { text: string; variant?: "body" | "small" }) {
  return (
    <Text variant={variant}>
      {inlineRuns(text).map((run, index) => (
        <Text key={index} variant={variant} className={run.bold ? "font-semibold" : run.code ? "bg-muted font-medium" : undefined}>
          {run.text}
        </Text>
      ))}
    </Text>
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <View className="gap-2.5">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <Text key={index} variant={block.level <= 2 ? "heading" : "subheading"} className={index > 0 ? "mt-2" : undefined}>
                {block.text.replace(/\*\*/g, "")}
              </Text>
            );
          case "bullet":
            return (
              <View key={index} className="flex-row gap-2.5" style={{ paddingLeft: block.depth * 16 }}>
                <Text variant="body" className="text-muted-foreground" accessibilityElementsHidden>
                  •
                </Text>
                <View className="flex-1">
                  <Inline text={block.text} />
                </View>
              </View>
            );
          case "numbered":
            return (
              <View key={index} className="flex-row gap-2.5">
                <Text variant="body" className="min-w-[20px] text-muted-foreground">
                  {block.number}.
                </Text>
                <View className="flex-1">
                  <Inline text={block.text} />
                </View>
              </View>
            );
          case "rule":
            return <View key={index} className="my-1 h-px bg-border" />;
          default:
            return <Inline key={index} text={block.text} />;
        }
      })}
    </View>
  );
}

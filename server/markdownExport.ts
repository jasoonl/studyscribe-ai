/**
 * Converts the Markdown that StudyScribe's notes and study guides are written
 * in into the two shapes the export destinations accept (E3): Notion blocks
 * and simple HTML (which Google Drive converts into a Google Doc). Only the
 * Markdown the notes actually use is handled: headings, bullet and numbered
 * lists, quotes, code blocks, rules, bold, italic, inline code and links.
 */

type Line =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "bullet"; text: string; depth: number }
  | { type: "numbered"; text: string; depth: number }
  | { type: "quote"; text: string }
  | { type: "code"; text: string; language: string }
  | { type: "divider" }
  | { type: "paragraph"; text: string };

export function parseMarkdownLines(markdown: string): Line[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: Line[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push({ type: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      out.push({ type: "code", text: body.join("\n"), language: fence[1] || "plain text" });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      out.push({ type: "heading", level: Math.min(3, heading[1].length) as 1 | 2 | 3, text: heading[2].replace(/\s+#+\s*$/, "").trim() });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push({ type: "divider" });
      continue;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      flush();
      out.push({ type: "bullet", text: bullet[2].replace(/^\[[ xX]\]\s*/, ""), depth: Math.floor(bullet[1].replace(/\t/g, "  ").length / 2) });
      continue;
    }
    const numbered = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (numbered) {
      flush();
      out.push({ type: "numbered", text: numbered[2], depth: Math.floor(numbered[1].replace(/\t/g, "  ").length / 2) });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flush();
      out.push({ type: "quote", text: quote[1] });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return out;
}

export type InlineRun = { text: string; bold?: boolean; italic?: boolean; code?: boolean; link?: string };

/** Splits inline Markdown into styled runs. Unbalanced markers are kept as text. */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /(\*\*|__)(.+?)\1|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(\*|_)([^*_]+?)\6/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index) });
    if (match[2] !== undefined) runs.push(...parseInline(match[2]).map(run => ({ ...run, bold: true })));
    else if (match[3] !== undefined) runs.push({ text: match[3], code: true });
    else if (match[4] !== undefined) runs.push({ text: match[4], link: match[5] });
    else if (match[7] !== undefined) runs.push({ text: match[7], italic: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.filter(run => run.text.length > 0);
}

// ---------------------------------------------------------------- Notion

const NOTION_TEXT_LIMIT = 2000;

function notionRichText(text: string) {
  const out: any[] = [];
  for (const run of parseInline(text)) {
    for (let i = 0; i < run.text.length; i += NOTION_TEXT_LIMIT) {
      out.push({
        type: "text",
        text: { content: run.text.slice(i, i + NOTION_TEXT_LIMIT), ...(run.link ? { link: { url: run.link } } : {}) },
        annotations: { bold: !!run.bold, italic: !!run.italic, code: !!run.code, strikethrough: false, underline: false, color: "default" },
      });
    }
  }
  return out.length ? out : [{ type: "text", text: { content: "" } }];
}

/** Notion blocks for a Markdown document. Nested list items are flattened to one level (Notion needs separate requests for children). */
export function markdownToNotionBlocks(markdown: string): any[] {
  return parseMarkdownLines(markdown).map(line => {
    switch (line.type) {
      case "heading": {
        const key = `heading_${line.level}`;
        return { object: "block", type: key, [key]: { rich_text: notionRichText(line.text) } };
      }
      case "bullet":
        return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: notionRichText(line.text) } };
      case "numbered":
        return { object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: notionRichText(line.text) } };
      case "quote":
        return { object: "block", type: "quote", quote: { rich_text: notionRichText(line.text) } };
      case "code":
        return { object: "block", type: "code", code: { rich_text: [{ type: "text", text: { content: line.text.slice(0, NOTION_TEXT_LIMIT) } }], language: "plain text" } };
      case "divider":
        return { object: "block", type: "divider", divider: {} };
      default:
        return { object: "block", type: "paragraph", paragraph: { rich_text: notionRichText(line.text) } };
    }
  });
}

// ---------------------------------------------------------------- HTML (Google Docs)

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function inlineHtml(text: string) {
  return parseInline(text)
    .map(run => {
      let html = escapeHtml(run.text);
      if (run.code) html = `<code>${html}</code>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      if (run.link) html = `<a href="${escapeHtml(run.link)}">${html}</a>`;
      return html;
    })
    .join("");
}

export function markdownToHtml(markdown: string, title: string): string {
  const parts: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) parts.push(`</${list}>`);
    list = null;
  };
  for (const line of parseMarkdownLines(markdown)) {
    if (line.type === "bullet" || line.type === "numbered") {
      const tag = line.type === "bullet" ? "ul" : "ol";
      if (list !== tag) {
        closeList();
        parts.push(`<${tag}>`);
        list = tag;
      }
      parts.push(`<li>${inlineHtml(line.text)}</li>`);
      continue;
    }
    closeList();
    if (line.type === "heading") parts.push(`<h${line.level}>${inlineHtml(line.text)}</h${line.level}>`);
    else if (line.type === "quote") parts.push(`<blockquote>${inlineHtml(line.text)}</blockquote>`);
    else if (line.type === "code") parts.push(`<pre>${escapeHtml(line.text)}</pre>`);
    else if (line.type === "divider") parts.push("<hr>");
    else parts.push(`<p>${inlineHtml(line.text)}</p>`);
  }
  closeList();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${parts.join("\n")}</body></html>`;
}

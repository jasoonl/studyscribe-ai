export type FlashcardExportFormat = "tsv" | "markdown";

export interface ExportableFlashcard {
  question: string;
  answer: string;
  difficulty?: string | null;
}

function cleanTsvValue(value: string) {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

export function createFlashcardExport(cards: ExportableFlashcard[], format: FlashcardExportFormat, title = "StudyScribe flashcards") {
  if (format === "tsv") {
    return {
      content: cards.map((card) => `${cleanTsvValue(card.question)}\t${cleanTsvValue(card.answer)}`).join("\n"),
      mimeType: "text/tab-separated-values;charset=utf-8",
      extension: "tsv",
    };
  }

  return {
    content: [
      `# ${title}`,
      "",
      "Imported from StudyScribe AI",
      "",
      ...cards.flatMap((card, index) => [
        `## ${index + 1}. ${card.question.trim()}`,
        "",
        card.answer.trim(),
        card.difficulty ? `\n_Difficulty: ${card.difficulty}_` : "",
        "",
      ]),
    ].join("\n"),
    mimeType: "text/markdown;charset=utf-8",
    extension: "md",
  };
}

export function downloadFlashcardExport(cards: ExportableFlashcard[], format: FlashcardExportFormat, title?: string) {
  const exportData = createFlashcardExport(cards, format, title);
  const blob = new Blob([exportData.content], { type: exportData.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = (title || "studyscribe-flashcards").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  link.href = url;
  link.download = `${safeName || "studyscribe-flashcards"}.${exportData.extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

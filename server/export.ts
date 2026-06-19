import { StudyNote, Flashcard } from "../drizzle/schema";

export function generateMarkdownNotes(notes: StudyNote[], title: string): string {
  let markdown = `# ${title}\n\n`;
  markdown += `Generated on: ${new Date().toLocaleDateString()}\n\n`;

  for (const note of notes) {
    markdown += `## ${note.type.replace(/_/g, " ").toUpperCase()}\n\n`;
    markdown += `${note.content}\n\n`;
  }

  return markdown;
}

export function generateMarkdownFlashcards(cards: Flashcard[], title: string): string {
  let markdown = `# ${title} - Flashcards\n\n`;
  markdown += `Generated on: ${new Date().toLocaleDateString()}\n`;
  markdown += `Total Cards: ${cards.length}\n\n`;

  cards.forEach((card, index) => {
    markdown += `## Card ${index + 1}\n\n`;
    markdown += `**Question:** ${card.question}\n\n`;
    markdown += `**Answer:** ${card.answer}\n\n`;
    markdown += `**Difficulty:** ${card.difficulty}\n\n`;
    markdown += `---\n\n`;
  });

  return markdown;
}

export function generatePdfContent(title: string, content: string): string {
  // Return HTML that can be converted to PDF
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
    h1 { color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
    h2 { color: #0066cc; margin-top: 20px; }
    p { color: #666; }
    .card { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .question { font-weight: bold; color: #0066cc; }
    .answer { margin-top: 10px; color: #333; }
    .difficulty { font-size: 0.9em; color: #999; margin-top: 5px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>Generated on: ${new Date().toLocaleDateString()}</p>
  <hr>
  ${content}
</body>
</html>
  `;
}

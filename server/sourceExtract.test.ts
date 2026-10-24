import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_SOURCE_CHARS, MAX_SOURCE_UNITS } from "@shared/const";
import {
  MAX_UNIT_CHARS, SourceExtractError, decodeText, detectKind, extractDocx, extractPdf, extractPlainText, extractPptx, extractSource,
  finalizeUnits, readZip,
} from "./sourceExtract";

const bytes = (text: string) => new TextEncoder().encode(text);

/** A tiny but valid PDF with one text page per entry (no fonts embedded; pdf.js reads the text with the built-in Helvetica). */
function makePdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, i) => {
    const pageId = 4 + i * 2;
    // pdf.js cuts a single string operand at about 100 characters, so text goes in as short lines.
    const lines = text.match(/.{1,60}/g) ?? [];
    const stream = `BT /F1 12 Tf 14 TL 72 700 Td ${lines.map(line => `(${line.replace(/[()\\]/g, "\\$&")}) Tj T*`).join(" ")} ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytes(out);
}

const slideXml = (...paragraphs: string[]) =>
  `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${paragraphs.map(p => `<p:sp><p:txBody><a:p><a:r><a:t>${p}</a:t></a:r></a:p></p:txBody></p:sp>`).join("")}</p:spTree></p:cSld></p:sld>`;

function makePptx(options: { reverseOrder?: boolean; noPresentation?: boolean } = {}) {
  const files: Record<string, Uint8Array> = {
    "ppt/slides/slide1.xml": strToU8(slideXml("Intro to cells", "Cells &amp; tissues")),
    "ppt/slides/slide2.xml": strToU8(slideXml("Mitosis", "Prophase &#8211; first stage")),
    "ppt/slides/_rels/slide2.xml.rels": strToU8(
      `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
    ),
    "ppt/notesSlides/notesSlide1.xml": strToU8(slideXml("Remember the spindle fibres", "2")),
    "docProps/app.xml": strToU8("<x/>"),
  };
  if (!options.noPresentation) {
    // Slide order comes from sldIdLst, not from file names.
    const ids = options.reverseOrder ? ["rId2", "rId1"] : ["rId1", "rId2"];
    files["ppt/presentation.xml"] = strToU8(`<p:presentation><p:sldIdLst>${ids.map((id, i) => `<p:sldId id="${256 + i}" r:id="${id}"/>`).join("")}</p:sldIdLst></p:presentation>`);
    files["ppt/_rels/presentation.xml.rels"] = strToU8(
      `<Relationships><Relationship Id="rId1" Type="x/slide" Target="slides/slide1.xml"/><Relationship Target="slides/slide2.xml" Type="x/slide" Id="rId2"/></Relationships>`,
    );
  }
  return zipSync(files);
}

const docPara = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const makeDocx = (body: string) => zipSync({ "word/document.xml": strToU8(`<w:document><w:body>${body}</w:body></w:document>`) });

describe("detectKind", () => {
  it("accepts matching extension and bytes", () => {
    expect(detectKind("notes.pdf", bytes("%PDF-1.7 ..."))).toBe("pdf");
    expect(detectKind("deck.PPTX", makePptx())).toBe("pptx");
    expect(detectKind("essay.docx", makeDocx(docPara("hi")))).toBe("docx");
    expect(detectKind("notes.md", bytes("# Title\ntext"))).toBe("text");
    expect(detectKind("notes.txt", bytes("plain"))).toBe("text");
  });

  it("rejects a file whose bytes disagree with its name", () => {
    expect(() => detectKind("fake.pdf", bytes("just text"))).toThrow(SourceExtractError);
    expect(() => detectKind("fake.docx", bytes("%PDF-1.4"))).toThrow(/does not look like a real Word/);
    expect(() => detectKind("fake.txt", bytes("%PDF-1.4"))).toThrow(SourceExtractError);
    expect(() => detectKind("fake.txt", makePptx())).toThrow(SourceExtractError);
  });

  it("rejects unknown types, legacy Office files and empty files", () => {
    expect(() => detectKind("a.exe", bytes("MZ"))).toThrow(/PDF, PowerPoint/);
    expect(() => detectKind("old.doc", bytes("x"))).toThrow(/\.docx/);
    expect(() => detectKind("old.ppt", bytes("x"))).toThrow(/\.pptx/);
    expect(() => detectKind("empty.txt", new Uint8Array())).toThrow(/empty/);
    expect(() => detectKind("noext", bytes("x"))).toThrow(SourceExtractError);
  });

  it("rejects text with NUL bytes or invalid UTF-8 and strips a BOM", () => {
    expect(() => detectKind("bin.txt", new Uint8Array([104, 105, 0, 106]))).toThrow(/not plain text/);
    expect(() => detectKind("latin.txt", new Uint8Array([0xe9, 0xe8, 0xff]))).toThrow(/UTF-8/);
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 104, 105]))).toBe("hi");
  });
});

describe("pptx", () => {
  it("orders slides by the slide list, decodes entities and appends speaker notes", async () => {
    const units = await extractPptx(makePptx());
    expect(units.map(unit => unit.label)).toEqual(["Slide 1: Intro to cells", "Slide 2: Mitosis"]);
    expect(units[0].text).toContain("Cells & tissues");
    expect(units[1].text).toContain("Prophase – first stage");
    expect(units[1].text).toContain("Speaker notes:");
    expect(units[1].text).toContain("Remember the spindle fibres");
    // The notes page's slide number is not content.
    expect(units[1].text.split("\n")).not.toContain("2");
  });

  it("follows the slide list when it differs from file order, and falls back to numeric order", async () => {
    const reversed = await extractPptx(makePptx({ reverseOrder: true }));
    expect(reversed.map(unit => unit.label)).toEqual(["Slide 1: Mitosis", "Slide 2: Intro to cells"]);
    const fallback = await extractPptx(makePptx({ noPresentation: true }));
    expect(fallback.map(unit => unit.label)).toEqual(["Slide 1: Intro to cells", "Slide 2: Mitosis"]);
  });

  it("rejects a zip that is not a presentation", async () => {
    await expect(extractPptx(zipSync({ "hello.txt": strToU8("x") }))).rejects.toThrow(/PowerPoint/);
  });
});

describe("docx", () => {
  it("starts a unit at each level 1 and 2 heading", async () => {
    const units = await extractDocx(
      makeDocx(docPara("Preface text") + docPara("Cells", "Heading1") + docPara("Cells are small &amp; busy") + docPara("Organelles", "Heading2") + docPara("Nucleus") + docPara("Minor", "Heading3") + docPara("Still organelles")),
    );
    expect(units.map(unit => unit.label)).toEqual(["Section 1", "Section 2: Cells", "Section 3: Organelles"]);
    expect(units[1].text).toContain("Cells are small & busy");
    expect(units[2].text).toContain("Still organelles");
  });

  it("keeps tabs and breaks and groups long runs of paragraphs", async () => {
    const long = docPara("word ".repeat(300));
    const units = await extractDocx(makeDocx(docPara("Topic", "Heading1") + long.repeat(5)));
    expect(units.length).toBeGreaterThan(1);
    expect(units.every(unit => unit.label.startsWith("Section"))).toBe(true);
    const tabbed = await extractDocx(makeDocx(`<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>`));
    expect(tabbed[0].text).toBe("a\tb\nc");
  });

  it("rejects a zip without a document", async () => {
    await expect(extractDocx(zipSync({ "x.txt": strToU8("x") }))).rejects.toThrow(/Word/);
  });
});

describe("plain text", () => {
  it("splits Markdown at headings", () => {
    const units = extractPlainText("intro line\n\n# Cells\nabout cells\n\n## Mitosis\nabout mitosis\n```\n# not a heading\n```");
    expect(units.map(unit => unit.label)).toEqual(["Section 1", "Section 2: Cells", "Section 3: Mitosis"]);
    expect(units[2].text).toContain("# not a heading");
  });

  it("groups paragraphs of text without headings", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${"x".repeat(600)}`).join("\n\n");
    const units = extractPlainText(text);
    expect(units.length).toBeGreaterThan(1);
    expect(units.every(unit => unit.text.length < 4_000)).toBe(true);
  });
});

describe("finalizeUnits", () => {
  it("normalises whitespace and drops empty units", () => {
    const result = finalizeUnits([
      { label: "A", text: "  hello \t  world \n\n\n\n next  " },
      { label: "B", text: "   \n " },
    ]);
    expect(result).toEqual([{ label: "A", text: "hello world\n\nnext" }]);
  });

  it("splits a very long unit into continued units", () => {
    const sentence = "This is a sentence about cells. ";
    const result = finalizeUnits([{ label: "Slide 3", text: sentence.repeat(1_000) }]);
    expect(result.length).toBeGreaterThan(2);
    expect(result[0].label).toBe("Slide 3");
    expect(result[1].label).toBe("Slide 3 (cont.)");
    expect(result.every(unit => unit.text.length <= MAX_UNIT_CHARS)).toBe(true);
    expect(result.every(unit => unit.label.length <= 80)).toBe(true);
  });

  it("enforces the unit and character caps with a clear error", () => {
    const many = Array.from({ length: MAX_SOURCE_UNITS + 1 }, (_, i) => ({ label: `Page ${i + 1}`, text: "some text" }));
    expect(() => finalizeUnits(many)).toThrow(/more than 400 pages/);
    const big = Array.from({ length: 40 }, (_, i) => ({ label: `Page ${i + 1}`, text: "a".repeat(11_000) }));
    expect(() => finalizeUnits(big)).toThrow(new RegExp(`more than ${MAX_SOURCE_CHARS.toLocaleString("en-US")} characters`));
  });
});

describe("zip limits", () => {
  it("refuses an entry that unpacks past the per-entry limit (a zip bomb) without inflating it all", async () => {
    const bomb = zipSync({ "word/document.xml": new Uint8Array(21 * 1024 * 1024) }, { level: 9 });
    expect(bomb.length).toBeLessThan(200_000);
    await expect(extractDocx(bomb)).rejects.toThrow(/too large once unpacked/);
  });

  it("refuses when the entries together unpack past the total limit", async () => {
    const entry = new Uint8Array(19 * 1024 * 1024);
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 6; i++) files[`ppt/slides/slide${i + 1}.xml`] = entry;
    await expect(extractPptx(zipSync(files, { level: 9 }))).rejects.toThrow(/too large once unpacked/);
  }, 30_000);

  it("only reads the entries it asks for", async () => {
    const entries = await readZip(zipSync({ "a.txt": strToU8("a"), "b.txt": strToU8("b") }), name => name === "a.txt");
    expect(Array.from(entries.keys())).toEqual(["a.txt"]);
  });

  it("reports a damaged archive plainly", async () => {
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(extractDocx(broken)).rejects.toBeInstanceOf(SourceExtractError);
  });
});

describe("pdf", () => {
  const sentence = "Photosynthesis converts light energy into chemical energy stored in glucose molecules. ";

  it("returns one unit per page and skips pages without text", async () => {
    const units = await extractPdf(makePdf([sentence.repeat(2), "", sentence + "Second page about chloroplasts."]));
    expect(units.map(unit => unit.label)).toEqual(["Page 1", "Page 3"]);
    expect(units[0].text).toContain("Photosynthesis");
    expect(units[1].text).toContain("chloroplasts");
  });

  it("fails a scanned PDF (no selectable text) with a clear message", async () => {
    await expect(extractPdf(makePdf(["", ""]))).rejects.toThrow(/no selectable text/);
    await expect(extractPdf(makePdf(["tiny"]))).rejects.toThrow(/no selectable text/);
  });

  it("fails a corrupt PDF cleanly", async () => {
    await expect(extractPdf(bytes("%PDF-1.4 this is not really a pdf"))).rejects.toBeInstanceOf(SourceExtractError);
  });

  it("stops when the time budget is spent", async () => {
    await expect(extractPdf(makePdf([sentence.repeat(3)]), { deadlineMs: -1 })).rejects.toThrow(/took too long/);
  });

  it("does not hand pdf.js the caller's buffer", async () => {
    const source = makePdf([sentence.repeat(3)]);
    await extractPdf(source);
    expect(source.byteLength).toBeGreaterThan(0);
  });
});

describe("extractSource", () => {
  it("detects, extracts and returns finished units", async () => {
    const { kind, units } = await extractSource("notes.md", bytes("# One\nalpha\n# Two\nbeta"));
    expect(kind).toBe("text");
    expect(units.map(unit => unit.label)).toEqual(["Section 1: One", "Section 2: Two"]);
  });

  it("fails a file with no text in it", async () => {
    await expect(extractSource("blank.txt", bytes("   \n  "))).rejects.toThrow(/No text/);
  });
});

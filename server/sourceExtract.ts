import { MAX_SOURCE_BYTES, MAX_SOURCE_CHARS, MAX_SOURCE_TEXT_BYTES, MAX_SOURCE_UNITS, sourceKindForFileName, type StudySourceKind } from "@shared/const";

/**
 * Text extraction for study sources (Phase 8). Pure: takes the file's bytes and
 * returns units (a PDF page, a slide, a document section) with no I/O. The
 * file is untrusted, so nothing in it is executed or fetched: PDFs are read
 * for text only, and the zip formats are read entry by entry with hard limits
 * on what is unpacked (a small file can expand into gigabytes).
 *
 * unpdf and fflate are imported lazily so they stay out of every other
 * request's cold start.
 */

export type ExtractedUnit = { label: string; text: string };

/** An error whose message is safe to show to the person (everything else is logged and replaced). */
export class SourceExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceExtractError";
  }
}

/** Largest single entry, and total, that may be unpacked from a pptx or docx. */
export const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024;
export const MAX_ZIP_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5_000;
const ZIP_SLICE_BYTES = 16 * 1024;
/** Largest XML part (as text) that is searched; real documents are far smaller. */
export const MAX_XML_CHARS = 8_000_000;
/** A PDF with less text than this is treated as scanned. */
export const MIN_PDF_CHARS = 200;
/** Units longer than this are split so a prompt part always has room for them. */
export const MAX_UNIT_CHARS = 12_000;
const GROUP_TARGET_CHARS = 3_000;
const LABEL_MAX = 80;
export const PDF_BUDGET_MS = 45_000;

const KIND_NAMES: Record<StudySourceKind, string> = { pdf: "PDF", pptx: "PowerPoint", docx: "Word", text: "text" };

// ------------------------------------------------------------ detection

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

/** UTF-8 text without NUL bytes (a binary file renamed .txt), BOM removed. Throws on anything else. */
export function decodeText(bytes: Uint8Array): string {
  let start = 0;
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) start = 3;
  if (bytes.includes(0)) throw new SourceExtractError("This file is not plain text. Save it as UTF-8 text or Markdown and try again.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
  } catch {
    throw new SourceExtractError("This text file is not UTF-8. Re-save it as UTF-8 and try again.");
  }
}

/**
 * The kind of a file from its name and its first bytes. The extension decides
 * what the person meant and the bytes must agree (browsers report blank or
 * wrong types all the time, and a renamed file should fail here, not deep in a
 * parser).
 */
export function detectKind(fileName: string, bytes: Uint8Array): StudySourceKind {
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.trim().toLowerCase() : "";
  if (extension === "doc" || extension === "ppt") {
    throw new SourceExtractError(`Old .${extension} files are not supported. Save it as ${extension === "doc" ? ".docx" : ".pptx"} and upload that.`);
  }
  const kind = sourceKindForFileName(fileName);
  if (!kind) throw new SourceExtractError("Upload a PDF, PowerPoint (.pptx), Word (.docx), .txt or .md file.");
  if (bytes.length === 0) throw new SourceExtractError("That file is empty.");

  const isPdf = startsWith(bytes, PDF_MAGIC);
  const isZip = startsWith(bytes, ZIP_MAGIC);
  const mismatch = () => new SourceExtractError(`This file does not look like a real ${KIND_NAMES[kind]} file. Check the file and try again.`);
  if (kind === "pdf" && !isPdf) throw mismatch();
  if ((kind === "pptx" || kind === "docx") && !isZip) throw mismatch();
  if (kind === "text") {
    if (isPdf || isZip) throw mismatch();
    decodeText(bytes);
  }
  return kind;
}

/** Size limit for a kind, in bytes. */
export function maxBytesForKind(kind: StudySourceKind) {
  return kind === "text" ? MAX_SOURCE_TEXT_BYTES : MAX_SOURCE_BYTES;
}

// ------------------------------------------------------------ units

/** Collapses runs of spaces and blank lines; keeps single line breaks and paragraph breaks. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map(line => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimLabel(label: string) {
  const clean = label.replace(/\s+/g, " ").trim();
  return clean.length > LABEL_MAX ? `${clean.slice(0, LABEL_MAX - 1).trimEnd()}…` : clean;
}

/** Splits `text` into pieces of at most `max` characters at a paragraph, line or sentence end (or a space, or hard). */
function splitLong(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf(" "));
    if (cut < max * 0.5) cut = max;
    else cut += 1;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * Normalises units, drops empty ones, splits very long ones ("(cont.)") and
 * enforces the unit and character caps with an error the person can act on.
 */
export function finalizeUnits(units: ExtractedUnit[]): ExtractedUnit[] {
  const result: ExtractedUnit[] = [];
  let chars = 0;
  for (const unit of units) {
    const text = normalizeText(unit.text);
    if (!text) continue;
    const label = trimLabel(unit.label) || `Part ${result.length + 1}`;
    const pieces = text.length > MAX_UNIT_CHARS ? splitLong(text, MAX_UNIT_CHARS) : [text];
    pieces.forEach((piece, index) => {
      chars += piece.length;
      if (chars > MAX_SOURCE_CHARS) {
        throw new SourceExtractError(`This file has more than ${MAX_SOURCE_CHARS.toLocaleString("en-US")} characters of text. Upload a shorter part of it.`);
      }
      result.push({ label: index === 0 ? label : trimLabel(`${label.slice(0, LABEL_MAX - 8).trimEnd()} (cont.)`), text: piece });
      if (result.length > MAX_SOURCE_UNITS) {
        throw new SourceExtractError(`This file has more than ${MAX_SOURCE_UNITS} pages, slides or sections. Upload a shorter part of it.`);
      }
    });
  }
  return result;
}

// ------------------------------------------------------------ XML helpers

type XmlElement = { name: string; open: string; inner: string };

const isNameChar = (code: number) => (code >= 48 && code <= 58) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45 || code === 46 || code === 95;

/**
 * The elements called one of `names`, in document order, found with indexOf. Regexes with lazy
 * `[\s\S]*?` bodies go quadratic on unclosed tags ("<a:p>" repeated), and the documents are
 * untrusted; every step here moves forward, so the time is linear in the input. A matched element
 * is not searched inside (call again on `inner`); one with no closing tag is skipped.
 */
export function scanElements(xml: string, names: string[]): XmlElement[] {
  if (xml.length > MAX_XML_CHARS) throw new SourceExtractError("This file is too large to read safely.");
  const found: XmlElement[] = [];
  const unclosed = new Set<string>();
  const length = xml.length;
  let position = 0;
  let gt = -1; // the first ">" at or after the end of the last name read
  while (true) {
    const start = xml.indexOf("<", position);
    if (start < 0) break;
    let end = start + 1;
    while (end < length && isNameChar(xml.charCodeAt(end))) end += 1;
    const name = xml.slice(start + 1, end);
    if (!names.includes(name)) {
      position = start + 1;
      continue;
    }
    if (gt < end) {
      gt = xml.indexOf(">", end);
      if (gt < 0) break;
    }
    const open = xml.slice(start, gt + 1);
    position = gt + 1;
    if (xml.charCodeAt(gt - 1) === 47) {
      found.push({ name, open, inner: "" });
      continue;
    }
    if (unclosed.has(name)) continue;
    const close = xml.indexOf(`</${name}>`, position);
    if (close < 0) {
      unclosed.add(name);
      continue;
    }
    found.push({ name, open, inner: xml.slice(position, close) });
    position = close + name.length + 3;
  }
  return found;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return " ";
      }
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag) ?? new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
  return match ? decodeXmlEntities(match[1]) : null;
}

type Relationship = { id: string; target: string; type: string };

function parseRelationships(xml: string | undefined): Relationship[] {
  if (!xml) return [];
  const result: Relationship[] = [];
  for (const element of scanElements(xml, ["Relationship"])) {
    const id = attribute(element.open, "Id");
    const target = attribute(element.open, "Target");
    if (id && target) result.push({ id, target, type: attribute(element.open, "Type") ?? "" });
  }
  return result;
}

/** Resolves a relationship target against the folder of the part that owns it ("../notesSlides/n.xml" from "ppt/slides"). */
function resolveTarget(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseDir.split("/").filter(Boolean);
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

// ------------------------------------------------------------ zip

type ZipEntries = Map<string, Uint8Array>;

/**
 * Reads only the entries `wanted` accepts, streaming so the size limits hold
 * for what is really inflated rather than for what the headers claim.
 */
export async function readZip(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<ZipEntries> {
  const { Unzip, UnzipInflate, UnzipPassThrough } = await import("fflate");
  const entries: ZipEntries = new Map();
  let seen = 0;
  let total = 0;
  let failure: SourceExtractError | null = null;
  const fail = (message: string) => {
    failure = new SourceExtractError(message);
    throw failure;
  };

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = file => {
    seen += 1;
    if (seen > MAX_ZIP_ENTRIES) fail("This file contains too many parts to read safely.");
    if (!wanted(file.name)) return;
    if (typeof file.originalSize === "number" && file.originalSize > MAX_ZIP_ENTRY_BYTES) fail("This file is too large once unpacked to read safely.");
    const chunks: Uint8Array[] = [];
    let entrySize = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        // fflate reports a throw from this very callback back through here; the first failure wins.
        failure = failure ?? new SourceExtractError("This file is damaged and could not be opened.");
        throw failure;
      }
      entrySize += chunk.length;
      total += chunk.length;
      if (entrySize > MAX_ZIP_ENTRY_BYTES || total > MAX_ZIP_TOTAL_BYTES) fail("This file is too large once unpacked to read safely.");
      chunks.push(chunk);
      if (final) {
        const joined = new Uint8Array(entrySize);
        let offset = 0;
        for (const part of chunks) {
          joined.set(part, offset);
          offset += part.length;
        }
        entries.set(file.name, joined);
      }
    };
    file.start();
  };
  try {
    // Fed in slices so the limits above fire while an entry is inflating, not after a whole bomb is in memory
    // (a local header can claim any size, and one push inflates everything it is given).
    for (let offset = 0; offset < bytes.length; offset += ZIP_SLICE_BYTES) {
      const end = Math.min(bytes.length, offset + ZIP_SLICE_BYTES);
      unzip.push(bytes.subarray(offset, end), end === bytes.length);
    }
    if (bytes.length === 0) unzip.push(new Uint8Array(), true);
  } catch (error) {
    if (failure) throw failure;
    if (error instanceof SourceExtractError) throw error;
    throw new SourceExtractError("This file is damaged and could not be opened.");
  }
  if (failure) throw failure;
  return entries;
}

const utf8 = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder("utf-8").decode(bytes) : undefined);

// ------------------------------------------------------------ pptx

/** Text of a DrawingML part: one string per `a:p` paragraph, runs joined, line breaks kept. */
export function drawingParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  for (const block of scanElements(xml, ["a:p"])) {
    let line = "";
    for (const token of scanElements(block.inner, ["a:t", "a:br"])) {
      line += token.name === "a:br" ? "\n" : decodeXmlEntities(token.inner);
    }
    const clean = line.trim();
    if (clean) paragraphs.push(clean);
  }
  return paragraphs;
}

export async function extractPptx(bytes: Uint8Array): Promise<ExtractedUnit[]> {
  const entries = await readZip(bytes, name => /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$/.test(name));
  const slideNames = Array.from(entries.keys()).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  if (slideNames.length === 0) throw new SourceExtractError("This file does not look like a PowerPoint presentation.");

  const numeric = (name: string) => Number.parseInt(/(\d+)\.xml$/.exec(name)![1], 10);
  let ordered: string[] = [];
  const presentation = utf8(entries.get("ppt/presentation.xml"));
  if (presentation) {
    const relationships = new Map(parseRelationships(utf8(entries.get("ppt/_rels/presentation.xml.rels"))).map(rel => [rel.id, rel.target]));
    for (const element of scanElements(presentation, ["p:sldId"])) {
      const target = relationships.get(attribute(element.open, "r:id") ?? "");
      const path = target ? resolveTarget("ppt", target) : null;
      if (path && entries.has(path)) ordered.push(path);
    }
  }
  // A damaged slide list falls back to file-name order.
  if (ordered.length === 0) ordered = slideNames.sort((a, b) => numeric(a) - numeric(b));

  return ordered.map((name, index) => {
    const paragraphs = drawingParagraphs(utf8(entries.get(name)) ?? "");
    const title = paragraphs[0]?.split("\n")[0] ?? "";
    const rels = parseRelationships(utf8(entries.get(name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels")));
    const notesRel = rels.find(rel => /notesSlide$/i.test(rel.type));
    const notesPath = notesRel ? resolveTarget("ppt/slides", notesRel.target) : null;
    // Notes pages repeat the slide number and often the slide text; only the paragraphs themselves are kept.
    const notes = notesPath && entries.has(notesPath) ? drawingParagraphs(utf8(entries.get(notesPath)) ?? "").filter(line => !/^\d+$/.test(line)) : [];
    const text = [...paragraphs, ...(notes.length ? ["Speaker notes:", ...notes] : [])].join("\n");
    return { label: title ? `Slide ${index + 1}: ${title}` : `Slide ${index + 1}`, text };
  });
}

// ------------------------------------------------------------ docx

function docxHeadingLevel(paragraphXml: string): number {
  const open = scanElements(paragraphXml, ["w:pStyle"])[0]?.open;
  const style = (open ? attribute(open, "w:val") : null) ?? "";
  const match = /^heading\s?([12])$/i.exec(style);
  if (match) return Number(match[1]);
  return /^title$/i.test(style) ? 1 : 0;
}

export async function extractDocx(bytes: Uint8Array): Promise<ExtractedUnit[]> {
  const entries = await readZip(bytes, name => name === "word/document.xml");
  const xml = utf8(entries.get("word/document.xml"));
  if (!xml) throw new SourceExtractError("This file does not look like a Word document.");

  const sections: Array<{ heading: string; paragraphs: string[] }> = [];
  let current: { heading: string; paragraphs: string[]; length: number } | null = null;
  const flush = () => {
    if (current && current.paragraphs.length) sections.push({ heading: current.heading, paragraphs: current.paragraphs });
    current = null;
  };

  for (const block of scanElements(xml, ["w:p"])) {
    let text = "";
    for (const token of scanElements(block.inner, ["w:t", "w:tab", "w:br", "w:cr"])) {
      if (token.name === "w:t") text += decodeXmlEntities(token.inner);
      else text += token.name === "w:tab" ? "\t" : "\n";
    }
    text = text.trim();
    if (!text) continue;
    if (docxHeadingLevel(block.inner) > 0) {
      flush();
      current = { heading: text.replace(/\s+/g, " ").slice(0, 60), paragraphs: [text], length: text.length };
      continue;
    }
    if (!current) current = { heading: "", paragraphs: [], length: 0 };
    current.paragraphs.push(text);
    current.length += text.length + 1;
    if (current.length >= GROUP_TARGET_CHARS) {
      const heading: string = current.heading;
      flush();
      // The rest of a long section carries on under the same heading.
      current = { heading, paragraphs: [], length: 0 };
    }
  }
  flush();

  return sections.map((section, index) => ({
    label: section.heading ? `Section ${index + 1}: ${section.heading}` : `Section ${index + 1}`,
    text: section.paragraphs.join("\n"),
  }));
}

// ------------------------------------------------------------ plain text

function groupParagraphs(text: string, target = GROUP_TARGET_CHARS): string[] {
  const groups: string[] = [];
  let buffer = "";
  for (const paragraph of text.split(/\n\s*\n/)) {
    const clean = paragraph.trim();
    if (!clean) continue;
    buffer = buffer ? `${buffer}\n\n${clean}` : clean;
    if (buffer.length >= target) {
      groups.push(buffer);
      buffer = "";
    }
  }
  if (buffer) groups.push(buffer);
  return groups;
}

export function extractPlainText(text: string): ExtractedUnit[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const isHeading = (line: string) => /^#{1,3}\s+\S/.test(line);
  if (lines.some(isHeading)) {
    const sections: Array<{ heading: string; lines: string[] }> = [{ heading: "", lines: [] }];
    let inFence = false;
    for (const line of lines) {
      if (/^```/.test(line)) inFence = !inFence;
      if (!inFence && isHeading(line)) sections.push({ heading: line.replace(/^#{1,3}\s+/, "").replace(/#+\s*$/, "").trim(), lines: [line] });
      else sections[sections.length - 1].lines.push(line);
    }
    return sections
      .filter(section => section.lines.join("").trim())
      .map((section, index) => ({ label: section.heading ? `Section ${index + 1}: ${section.heading}` : `Section ${index + 1}`, text: section.lines.join("\n") }));
  }
  return groupParagraphs(normalized).map((group, index) => ({ label: `Section ${index + 1}`, text: group }));
}

// ------------------------------------------------------------ pdf

export async function extractPdf(bytes: Uint8Array, options: { deadlineMs?: number } = {}): Promise<ExtractedUnit[]> {
  const deadline = Date.now() + (options.deadlineMs ?? PDF_BUDGET_MS);
  const { getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js takes ownership of the buffer it is given, so it gets a copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, useSystemFonts: false, disableFontFace: true } as any);
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "PasswordException") {
      throw new SourceExtractError("This PDF is password protected. Remove the password and upload it again.");
    }
    throw new SourceExtractError("This PDF is damaged or not a real PDF, so its text could not be read.");
  }

  try {
    if (pdf.numPages > MAX_SOURCE_UNITS) {
      throw new SourceExtractError(`This PDF has ${pdf.numPages} pages; the limit is ${MAX_SOURCE_UNITS}. Upload a shorter part of it.`);
    }
    const units: ExtractedUnit[] = [];
    let chars = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (Date.now() > deadline) throw new SourceExtractError("Reading this PDF took too long. Upload a shorter part of it.");
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      page.cleanup();
      let text = "";
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str !== "string") continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      const clean = normalizeText(text);
      if (!clean) continue;
      chars += clean.length;
      if (chars > MAX_SOURCE_CHARS * 2) throw new SourceExtractError(`This file has more than ${MAX_SOURCE_CHARS.toLocaleString("en-US")} characters of text. Upload a shorter part of it.`);
      units.push({ label: `Page ${pageNumber}`, text: clean });
    }
    if (units.reduce((sum, unit) => sum + unit.text.length, 0) < MIN_PDF_CHARS) {
      throw new SourceExtractError("This PDF has no selectable text. Scanned PDFs are not supported yet; upload a version with real text.");
    }
    return units;
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.()?.catch(() => undefined);
  }
}

// ------------------------------------------------------------ entry point

/** Detects the kind, checks the size and returns the finished units. Throws SourceExtractError with a message fit to show. */
export async function extractSource(fileName: string, bytes: Uint8Array, options: { deadlineMs?: number } = {}): Promise<{ kind: StudySourceKind; units: ExtractedUnit[] }> {
  const kind = detectKind(fileName, bytes);
  if (bytes.length > maxBytesForKind(kind)) throw new SourceExtractError("That file is larger than the size limit.");
  let units: ExtractedUnit[];
  switch (kind) {
    case "pdf":
      units = await extractPdf(bytes, options);
      break;
    case "pptx":
      units = await extractPptx(bytes);
      break;
    case "docx":
      units = await extractDocx(bytes);
      break;
    default:
      units = extractPlainText(decodeText(bytes));
  }
  const finished = finalizeUnits(units);
  if (finished.length === 0) throw new SourceExtractError("No text could be found in this file.");
  return { kind, units: finished };
}

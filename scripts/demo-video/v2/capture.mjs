// Captures the app screenshots the demo video is built from, and measures the
// highlight/click targets on each one so scenes.js never needs hand-measured numbers.
//
//   1. Run the app against a local database seeded with seed-library.mjs.
//   2. node capture.mjs [baseUrl]            (default http://localhost:3000)
//
// Writes ../frames/<name>.jpg (2800x1568) and rects.js. Rects are [x, y, w, h, radius]
// in the 1600x896 space the scenes draw screenshots in. CHROMIUM_PATH picks the browser
// binary; otherwise the installed Google Chrome is used.
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://localhost:3000";
const EMAIL = process.env.DEMO_USER_EMAIL || "demo@example.com";
const PASSWORD = process.env.DEMO_USER_PASSWORD || "demo-password-1";
const VIEW = { width: 1280, height: 717 };
const SCALE = 1600 / VIEW.width; // CSS px -> 1600x896 frame space

// Screenshot-only styling, applied on top of the app's own CSS:
// - The sticky header and the test-mode footer are 95% opaque with a backdrop blur, so a
//   scrolled page shows blurred ghost text through them in a still frame. Make them solid.
// - The app's monospace stack (ui-monospace, SFMono-Regular, Menlo, ...) is SF Mono on a Mac,
//   but falls through to Liberation Mono (a Courier clone) on Linux. Alias SFMono-Regular to the
//   bundled Geist Mono so timestamps look the way Mac users see them.
const MONO = readFileSync(resolve(here, "assets/geist-mono.woff2")).toString("base64");
const CAPTURE_CSS = `
  @font-face { font-family: "SFMono-Regular"; src: url(data:font/woff2;base64,${MONO}) format("woff2"); font-weight: 100 900; }
  .sticky.top-0[class*="bg-background/95"] { background-color: var(--background) !important; backdrop-filter: none !important; }
  .sticky[class*="bg-card/95"] { background-color: var(--card) !important; backdrop-filter: none !important; }
`;

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chrome" }),
  args: ["--hide-scrollbars", "--force-color-profile=srgb"],
});
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2800 / VIEW.width });
await ctx.addInitScript((css) => {
  try {
    localStorage.setItem("studyscribe_auto_notes", "off");
    localStorage.setItem("studyscribe_onboarding_done", "true");
    localStorage.setItem("studyscribe_cookie_consent", "declined");
  } catch {}
  const add = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
  if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
}, CAPTURE_CSS);
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
if (!login.ok()) throw new Error(`Login failed (${login.status()}). Seed the library first.`);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.warn("page error:", e.message));

const list = await (await ctx.request.get(`${BASE}/api/trpc/recordings.list`)).json();
const byTitle = Object.fromEntries((list.result.data.json ?? list.result.data).map((r) => [r.title, r.id]));
const id = (title) => {
  if (!byTitle[title]) throw new Error(`Recording "${title}" not found. Run seed-library.mjs.`);
  return byTitle[title];
};

const rects = {};
const settle = async () => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(350); };
const go = async (path) => { await page.goto(BASE + path, { waitUntil: "networkidle" }); await page.waitForTimeout(800); };
// Scrolls so the element's top edge sits `offset` CSS px below the top of the viewport.
const scrollTo = async (locator, offset) => {
  await locator.first().evaluate((el, o) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - o), offset);
  await page.waitForTimeout(350);
};
// [x, y, w, h, radius] in frame space; radius is the element's own corner radius (a pill's is h/2).
const rect = async (locator) => {
  const [x, y, w, h, r] = await locator.first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    return [b.x, b.y, b.width, b.height, Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, b.height / 2, b.width / 2)];
  });
  return [x, y, w, h, r].map((v) => Math.round(v * SCALE));
};
const union = (...rs) => {
  const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]));
  const x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0, 0];
};
const centre = ([x, y, w, h]) => [Math.round(x + w / 2), Math.round(y + h / 2)];
// Bottom edge of the page header (or bar) in frame space, so the video can crop just below it.
const top = async () => Math.round((await headerBottom()) * SCALE);
const shot = async (name, { keepMouse = false } = {}) => {
  if (!keepMouse) await page.mouse.move(0, 0);
  // Anything scrolled fully behind the sticky header (or above the window) is out of the picture, so
  // its shadow must not be either: a selected tab's glow would otherwise smear the card below it.
  await page.evaluate(() => {
    const header = [...document.querySelectorAll(".sticky.top-0")].find((e) => getComputedStyle(e).position === "sticky");
    const hb = header ? header.getBoundingClientRect().bottom : 0;
    for (const el of document.querySelectorAll("body *")) {
      if (header && header.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom <= hb + 0.5 && getComputedStyle(el).boxShadow !== "none") el.style.boxShadow = "none";
    }
  });
  await settle();
  await page.screenshot({ path: resolve(here, "../frames", `${name}.jpg`), type: "jpeg", quality: 92 });
  console.log("frame", name);
};
const tab = async (name) => { await page.getByRole("tab", { name }).first().click(); await page.waitForTimeout(700); };
// The sticky header's bottom edge (0 when the page has none).
const headerBottom = async () => page.evaluate(() => {
  const h = [...document.querySelectorAll(".sticky.top-0")].find((e) => getComputedStyle(e).position === "sticky");
  return h ? h.getBoundingClientRect().bottom : 0;
});
// Scrolls an element up to just below the sticky header (or the top of the window), so that
// whatever sits above it ends exactly behind the header instead of peeking out under it: the
// page's own gap above the element is measured and kept. (shot() removes the hidden element's shadow.)
const scrollBelowHeader = async (locator) => {
  await scrollTo(locator, 420);
  const gap = await locator.first().evaluate((el) => {
    const b = el.getBoundingClientRect(), mine = new Set();
    for (let a = el; a; a = a.parentElement) mine.add(a);
    for (let d = 1; d < 120; d++) {
      for (const x of [b.left + 24, b.left + b.width / 2, b.right - 24]) {
        const hit = document.elementFromPoint(x, b.top - d);
        if (hit && !mine.has(hit)) return d - 1;
      }
    }
    return 24;
  });
  await scrollTo(locator, (await headerBottom()) + gap);
};

// Library
await go("/dashboard");
await shot("dashboard");

// Add a recording: the three ways in, then the language picker
await go("/record-or-upload");
const cardOf = (title) => page.locator("div.border-2", { has: page.getByRole("heading", { name: title, exact: true }) });
await scrollTo(cardOf("Record Live"), (await headerBottom()) + 64); // the consent note stays in view above the cards
rects.add = {
  banner: await rect(page.getByRole("note")),
  cards: [await rect(cardOf("Record Live")), await rect(cardOf("Upload File")), await rect(cardOf("From a Link"))],
  buttons: [
    centre(await rect(page.getByRole("button", { name: /Start Recording/ }))),
    centre(await rect(page.getByRole("button", { name: /^Upload File$/ }))),
    centre(await rect(page.getByRole("button", { name: /Import Link/ }))),
  ],
};
await shot("add-recording");

// The link form with Spanish picked and the list open again. The form fits the window, so the
// list would open upwards over the page header; a little room below the page lets it scroll so
// the list opens downwards instead, the way it does on a taller screen.
await page.getByRole("button", { name: /Import Link/ }).click();
await page.waitForTimeout(600);
await page.getByPlaceholder(/youtube\.com/).fill("https://media.example.edu/spanish-201/week-6-preterite.mp3");
await page.getByPlaceholder("Defaults to the file name").fill("Spanish 201: Preterite vs Imperfect");
await page.evaluate(() => { document.body.style.paddingBottom = "600px"; });
const trigger = page.getByLabel("Spoken language");
await trigger.click();
await page.getByRole("option", { name: "Spanish", exact: true }).click();
await page.waitForTimeout(300);
await scrollBelowHeader(page.getByText("Title (optional)", { exact: true }).locator("xpath=.."));
await trigger.click();
await page.waitForTimeout(600);
const spanish = page.getByRole("option", { name: "Spanish", exact: true });
await spanish.focus();
await page.waitForTimeout(300);
rects.language = { label: await rect(page.getByText("Spoken language", { exact: true })), radios: await rect(page.getByText("Professional Meeting", { exact: true })), spanish: await rect(spanish) };
await shot("language", { keepMouse: true });
await page.keyboard.press("Escape");

// Transcript: thermodynamics, two speakers
await go(`/recording/${id("Thermodynamics, lecture 4")}`);
const transcriptCard = page.locator("div.border-2", { has: page.getByText("Full Transcript", { exact: true }) }).last();
await scrollBelowHeader(transcriptCard);
const line = page.locator("div.cursor-pointer", { hasText: "The fridge is not isolated" });
const speaker = line.getByRole("button", { name: /Prof\. Lee/ }).or(line.getByText("Prof. Lee", { exact: true }));
rects.transcript = { line: await rect(line), click: centre(await rect(line)), speaker: await rect(speaker), stamp: await rect(line.getByText("0:23", { exact: true })), column: await rect(transcriptCard) };
await shot("transcript");

// Spanish class transcript (for "another language")
await go(`/recording/${id("Spanish 201: Preterite vs Imperfect")}`);
// The transcript is short, so the page cannot scroll it to the top: show the study-mode tabs above it whole.
await scrollBelowHeader(page.getByRole("tab", { name: /Transcript/ }));
await shot("spanish-transcript");

// Study notes: microeconomics
await go(`/recording/${id("Intro to Microeconomics: Supply and Demand")}`);
await tab(/Study Notes/);
const notesCard = page.locator("div.border-2", { has: page.getByText("Lecture notes", { exact: true }) }).last();
await scrollBelowHeader(notesCard);
// A heading and the list after it; list markers hang outside the list's box, so include them.
const noteSection = async (heading) => {
  const h = page.getByRole("heading", { name: heading });
  const ul = h.locator("xpath=following-sibling::*[1]");
  const markerLeft = await ul.evaluate((el) => {
    const li = el.querySelector("li"); if (!li) return el.getBoundingClientRect().left;
    const fs = parseFloat(getComputedStyle(li).fontSize);
    return li.getBoundingClientRect().left - fs * 1.1; // a disc marker and its gap span about 1.1em
  });
  const u = union(await rect(h), await rect(ul));
  const left = Math.min(u[0], Math.round(markerLeft * SCALE));
  return [left, u[1], u[0] + u[2] - left, u[3], 0];
};
rects.notes = { concepts: await noteSection("Key Concepts"), formulas: await noteSection("Formulas and Definitions"), column: await rect(notesCard) };
await shot("study-notes");

// Flashcards: the Intro to AI deck, so the screen matches the cards drawn over it
await go(`/recording/${id("Intro to Artificial Intelligence")}`);
await tab(/Flashcards/);
await page.getByRole("button", { name: /Start review/ }).click();
await page.waitForTimeout(600);
// The deck's progress card (new / learning / mastered) at the top, the card under review below it.
await scrollBelowHeader(page.locator("div.border-2", { has: page.getByText("mastered") }).filter({ hasNot: page.getByText(/Card 1 of/) }).last());
await shot("flashcards");

// Learn mode: written recall on the cell biology deck
const bio = id("Cell Biology: Mitochondria and ATP");
await go(`/recording/${bio}`);
await tab(/Learn/);
const box = page.getByPlaceholder("Write the answer from memory…");
const learnCard = box.locator("xpath=ancestor::div[contains(@class,'border')][1]");
await scrollBelowHeader(page.getByText("Learn Mode", { exact: true }).locator("xpath=ancestor::div[contains(@class,'border')][1]"));
// The typing overlay in scenes.js draws text with the textarea's own font and padding.
const font = await box.evaluate((el) => {
  const s = getComputedStyle(el);
  let bg = "rgb(255, 255, 255)";
  for (let a = el; a; a = a.parentElement) { const c = getComputedStyle(a).backgroundColor; if (c && c !== "transparent" && !/rgba\(.*, 0\)$/.test(c)) { bg = c; break; } }
  return { size: parseFloat(s.fontSize), weight: s.fontWeight, lineHeight: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.5, padX: parseFloat(s.paddingLeft), padY: parseFloat(s.paddingTop), border: parseFloat(s.borderTopWidth), color: s.color, background: bg, letterSpacing: s.letterSpacing };
});
rects.learn = {
  input: await rect(box), card: await rect(learnCard),
  font: { ...font, size: +(font.size * SCALE).toFixed(2), lineHeight: +(font.lineHeight * SCALE).toFixed(2), padX: +(font.padX * SCALE).toFixed(2), padY: +(font.padY * SCALE).toFixed(2), border: +(font.border * SCALE).toFixed(2) },
};
await shot("learn-mode");

// Test mode: practice exam
await go(`/recording/${bio}`);
await tab(/^Test/);
const testHead = page.getByText("Test Mode", { exact: true }).locator("xpath=ancestor::div[contains(@class,'border')][1]");
await scrollBelowHeader(testHead);
const option = page.locator("button.rounded-2xl").first();
rects.test = { option: await rect(option), click: centre(await rect(option)), column: await rect(testHead) };
await shot("test-mode");

// Quiz: World War I, ten questions
await go(`/recordings/${id("World History: Causes of World War I")}/quizzes`);
await page.getByRole("button", { name: /Start Quiz/ }).first().click();
await page.waitForTimeout(700);
const answer = page.getByText("Militarism, alliances, imperialism, nationalism", { exact: true });
const answerRow = answer.locator("xpath=ancestor::*[self::button or self::label or contains(@class,'border')][1]");
const quizCard = page.locator("div", { has: page.getByText("What does the acronym MAIN stand for?") }).filter({ has: page.getByRole("button", { name: "Next" }) }).last();
rects.quiz = { top: await top(), option: await rect(answerRow), click: centre(await rect(answerRow)), card: await rect(quizCard) };
await shot("quiz");

// Study guide: organic chemistry
await go(`/recordings/${id("Organic Chemistry: SN1 vs SN2 Reactions")}/study-guides`);
await page.getByText("Study Guide: SN1 vs SN2").first().click();
await page.waitForTimeout(700);
const guideTitle = page.getByText("Study Guide: SN1 vs SN2", { exact: true }).last();
const guideHeader = guideTitle.locator("xpath=ancestor::*[contains(@class,'border-b')][1]");
const guideCard = guideHeader.locator("xpath=..");
rects.guide = { header: await rect(guideHeader), card: await rect(guideCard) };
await shot("study-guide");

// AI tutor: psychology
await go(`/recording/${id("Intro to Psychology: Classical Conditioning")}`);
await tab(/AI Assistant/);
const tutorCard = page.locator("div.border-2", { has: page.getByText(/AI Tutor - Ask questions/) }).last();
await scrollBelowHeader(tutorCard);
rects.tutor = { card: await rect(tutorCard) };
await shot("ai-tutor");

// Email drafts: product roadmap meeting
await go(`/recordings/${id("Q3 Product Roadmap Sync")}/email-drafts`);
await page.getByText("Email Summary: Q3 Product Roadmap Sync").first().click();
await page.waitForTimeout(700);
const copy = page.getByRole("button", { name: /^Copy$/ });
rects.email = { copy: await rect(copy), click: centre(await rect(copy)), tone: await rect(page.getByRole("combobox").first()) };
await shot("email-drafts");

// Analytics: the three newest recordings (a 40-second reading, a 7-minute class, a 52-minute lecture)
await go("/analytics");
const recentTitles = ["Poetry Reading: The Road Not Taken", "Spanish 201: Preterite vs Imperfect", "Cell Biology: Mitochondria and ATP"];
const rowOf = (title) => page.getByText(title, { exact: true }).locator("xpath=ancestor::div[contains(@class,'cursor-pointer')][1]");
// The page ends soon after the list, so the second row of stats stays in view above it.
await scrollBelowHeader(page.getByText("Quizzes", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded')][1]"));
rects.library = {
  stats: await rect(page.getByText("Quizzes", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded')][1]")),
  heading: await rect(page.getByText("Recent Recordings", { exact: true })),
  rows: await Promise.all(recentTitles.map((t) => rect(rowOf(t)))),
};
await shot("analytics");

writeFileSync(resolve(here, "rects.js"), `// Generated by capture.mjs from the live app. Do not edit by hand; re-run capture.mjs.\nwindow.__RECTS = ${JSON.stringify(rects)};\n`);
console.log(JSON.stringify(rects));
await browser.close();

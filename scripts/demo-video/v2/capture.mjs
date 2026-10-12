// Captures the app screenshots the demo video is built from, and measures the
// highlight/click targets on each one so scenes.js never needs hand-measured numbers.
//
//   1. Run the app against a local database seeded with seed-library.mjs.
//   2. node capture.mjs [baseUrl]            (default http://localhost:3000)
//
// Writes ../frames/<name>.jpg (2800x1568) and rects.js. Rects are in the 1600x896
// space the scenes draw screenshots in. CHROMIUM_PATH picks the browser binary;
// otherwise the installed Google Chrome is used.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://localhost:3000";
const EMAIL = process.env.DEMO_USER_EMAIL || "demo@example.com";
const PASSWORD = process.env.DEMO_USER_PASSWORD || "demo-password-1";
const VIEW = { width: 1280, height: 717 };
const SCALE = 1600 / VIEW.width; // CSS px -> 1600x896 frame space

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chrome" });
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2800 / VIEW.width });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("studyscribe_auto_notes", "off");
    localStorage.setItem("studyscribe_onboarding_done", "true");
  } catch {}
});
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
const go = async (path) => { await page.goto(BASE + path, { waitUntil: "networkidle" }); await page.waitForTimeout(800); };
const scrollTo = async (locator, offset) => {
  await locator.first().evaluate((el, o) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - o), offset);
  await page.waitForTimeout(350);
};
const rect = async (locator, pad = 0) => {
  const b = await locator.first().boundingBox();
  if (!b) throw new Error(`No box for ${locator}`);
  return [b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2].map((v) => Math.round(v * SCALE));
};
const centre = ([x, y, w, h]) => [Math.round(x + w / 2), Math.round(y + h / 2)];
const shot = async (name) => {
  await page.mouse.move(0, 0);
  await page.screenshot({ path: resolve(here, "../frames", `${name}.jpg`), type: "jpeg", quality: 90 });
  console.log("frame", name);
};
const tab = async (name) => { await page.getByRole("tab", { name }).first().click(); await page.waitForTimeout(700); };

// Library
await go("/dashboard");
await shot("dashboard");

// Add a recording: the three ways in, then the language picker
await go("/record-or-upload");
const cardOf = (title) => page.locator("div.border-2", { has: page.getByRole("heading", { name: title, exact: true }) });
await scrollTo(cardOf("Record Live"), 150);
rects.add = {
  cards: [await rect(cardOf("Record Live")), await rect(cardOf("Upload File")), await rect(cardOf("From a Link"))],
  buttons: [
    centre(await rect(page.getByRole("button", { name: /Start Recording/ }))),
    centre(await rect(page.getByRole("button", { name: /^Upload File$/ }))),
    centre(await rect(page.getByRole("button", { name: /Import Link/ }))),
  ],
};
await shot("add-recording");
await cardOf("From a Link").click();
await page.waitForTimeout(600);
await page.getByLabel("Spoken language").click();
await page.waitForTimeout(500);
const spanish = page.getByRole("option", { name: "Spanish", exact: true });
await spanish.hover();
await page.waitForTimeout(300);
rects.language = { list: await rect(page.getByRole("listbox")), spanish: await rect(spanish), trigger: await rect(page.getByLabel("Spoken language")) };
await shot("language");
await page.keyboard.press("Escape");

// Transcript: thermodynamics, two speakers
await go(`/recording/${id("Thermodynamics, lecture 4")}`);
await scrollTo(page.getByText("Full Transcript"), 70);
const line = page.locator("div.cursor-pointer", { hasText: "The fridge is not isolated" });
rects.transcript = { line: await rect(line), click: centre(await rect(line)), speaker: await rect(line.getByRole("button", { name: /Rename|Prof/ }).or(line.locator("button").nth(1))) };
await shot("transcript");

// Spanish class transcript (for "another language")
await go(`/recording/${id("Spanish 201: Preterite vs Imperfect")}`);
await scrollTo(page.getByText("Full Transcript"), 70);
await shot("spanish-transcript");

// Study notes: microeconomics
await go(`/recording/${id("Intro to Microeconomics: Supply and Demand")}`);
await tab(/Study Notes/);
await scrollTo(page.getByText("Lecture notes").first(), 90);
const noteSection = async (heading) => {
  const h = page.getByRole("heading", { name: heading });
  const list = h.locator("xpath=following-sibling::*[1]");
  const a = await rect(h), b = await rect(list);
  return [a[0], a[1], Math.max(a[2], b[2]), b[1] + b[3] - a[1]];
};
rects.notes = { concepts: await noteSection("Key Concepts"), formulas: await noteSection("Formulas and Definitions") };
await shot("study-notes");

// Flashcards: cell biology review card
const bio = id("Cell Biology: Mitochondria and ATP");
await go(`/recording/${bio}`);
await tab(/Flashcards/);
await page.getByRole("button", { name: /Start review/ }).click();
await page.waitForTimeout(600);
await scrollTo(page.getByText(/Card 1 of/).first(), 150);
await shot("flashcards");

// Learn mode: written recall
await go(`/recording/${bio}`);
await tab(/Learn/);
const box = page.getByPlaceholder("Write the answer from memory…");
await scrollTo(box, 330);
const learnQuestion = (await page.locator("h3, p.text-xl, p.text-2xl").filter({ hasText: /\?$/ }).first().textContent())?.trim();
rects.learn = { input: await rect(box), card: await rect(box.locator("xpath=ancestor::div[contains(@class,'border')][1]")), question: learnQuestion };
await shot("learn-mode");

// Test mode: practice exam
await go(`/recording/${bio}`);
await tab(/^Test/);
await scrollTo(page.getByText("Test Mode", { exact: true }).first(), 90);
const option = page.locator("button.rounded-2xl").first();
rects.test = { option: await rect(option), click: centre(await rect(option)) };
await shot("test-mode");

// Quiz: World War I, ten questions
await go(`/recordings/${id("World History: Causes of World War I")}/quizzes`);
await page.getByRole("button", { name: /Start Quiz/ }).first().click();
await page.waitForTimeout(700);
const answer = page.getByText("Militarism, alliances, imperialism, nationalism", { exact: true });
rects.quiz = { option: await rect(answer.locator("xpath=ancestor::*[self::button or self::label or contains(@class,'border')][1]")), click: centre(await rect(answer)) };
await shot("quiz");

// Study guide: organic chemistry
await go(`/recordings/${id("Organic Chemistry: SN1 vs SN2 Reactions")}/study-guides`);
await page.getByText("Study Guide: SN1 vs SN2").first().click();
await page.waitForTimeout(700);
const guideTitle = page.getByText("Study Guide: SN1 vs SN2", { exact: true }).last();
const tableHead = page.getByRole("heading", { name: "Overview" });
const gt = await rect(guideTitle, 16), kc = await rect(tableHead);
rects.guide = { header: [gt[0], gt[1], 1600 - gt[0] - 40, kc[1] - gt[1] - 10] };
await shot("study-guide");

// AI tutor: psychology
await go(`/recording/${id("Intro to Psychology: Classical Conditioning")}`);
await tab(/AI Assistant/);
await scrollTo(page.getByText(/AI Tutor/).first(), 90);
await shot("ai-tutor");

// Email drafts: product roadmap meeting
await go(`/recordings/${id("Q3 Product Roadmap Sync")}/email-drafts`);
await page.getByText("Email Summary: Q3 Product Roadmap Sync").first().click();
await page.waitForTimeout(700);
const copy = page.getByRole("button", { name: /^Copy$/ });
rects.email = { copy: await rect(copy, 4), click: centre(await rect(copy)) };
await shot("email-drafts");

// Analytics: the three newest recordings (40s reading, 7-minute class, 1-minute lecture)
await go("/analytics");
const rowOf = (title) => page.getByText(title, { exact: true }).locator("xpath=ancestor::div[contains(@class,'cursor-pointer')][1]");
const recent = page.getByText("Poetry Reading: The Road Not Taken", { exact: true });
await scrollTo(recent, 260);
rects.library = {
  rows: [
    await rect(rowOf("Poetry Reading: The Road Not Taken")),
    await rect(rowOf("Spanish 201: Preterite vs Imperfect")),
    await rect(rowOf("Intro to Artificial Intelligence")),
  ],
};
await shot("analytics");

writeFileSync(resolve(here, "rects.js"), `// Generated by capture.mjs from the live app. Do not edit by hand; re-run capture.mjs.\nwindow.__RECTS = ${JSON.stringify(rects, null, 2)};\n`);
console.log(JSON.stringify(rects));
await browser.close();

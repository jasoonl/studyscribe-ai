// Retakes the landing page screenshots in client/public/landing from the live app.
//
//   1. Run the app against a local database seeded with
//      scripts/demo-video/v2/seed-library.mjs (it refuses non-local databases).
//   2. node scripts/landing/capture.mjs [baseUrl]      (default http://localhost:3000)
//
// Writes <name>.jpg (1600x896, the hero, How it works and Use cases) and
// <name>-focus.jpg (just the card that matters, for the small feature tiles, where a
// whole page shrunk to tile size is unreadable). Needs playwright-core next to it or
// on the path; CHROMIUM_PATH picks the browser binary, otherwise installed Chrome.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../client/public/landing");
const BASE = process.argv[2] || "http://localhost:3000";
const EMAIL = process.env.DEMO_USER_EMAIL || "demo@example.com";
const PASSWORD = process.env.DEMO_USER_PASSWORD || "demo-password-1";
// 1000x560 CSS px at 1.6x gives the 1600x896 the <img> tags declare; a narrow window keeps the
// text large and the recording page in one column.
const VIEW = { width: 1000, height: 560 };

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chrome" }),
  args: ["--hide-scrollbars", "--force-color-profile=srgb"],
});
const login = await browser.newContext();
const res = await login.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
if (!res.ok()) throw new Error(`Login failed (${res.status()}). Seed the library first.`);
const me = await (await login.request.get(`${BASE}/api/auth/me`)).json();
const userId = me.user?.id ?? me.id;
const state = await login.storageState();
await login.close();

// The feature tiles are about 330px wide, so their crops are taken at phone width, where each
// card is laid out narrow and its text stays readable at tile size.
const CROP_VIEW = { width: 520, height: 900 };

const prepare = async (view, scale) => {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: scale, storageState: state });
  await ctx.addInitScript((uid) => {
    try {
      localStorage.setItem("studyscribe_auto_notes", "off");
      localStorage.setItem("studyscribe_onboarding_done", "true");
      localStorage.setItem("studyscribe_cookie_consent", "declined");
      localStorage.setItem(`studyscribe_setup_checklist_hidden:${uid}`, "1");
    } catch {}
    // Sticky bars are 95% opaque with a blur; in a still frame that reads as smudged text.
    const css = `.sticky.top-0[class*="bg-background/95"],.glass{background-color:var(--background)!important;backdrop-filter:none!important}`;
    const add = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
    if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
  }, userId);
  return ctx;
};

const full = await (await prepare(VIEW, 1600 / VIEW.width)).newPage();
const crop = await (await prepare(CROP_VIEW, 2)).newPage();
for (const p of [full, crop]) p.on("pageerror", (e) => console.warn("page error:", e.message));

const list = await (await full.request.get(`${BASE}/api/trpc/recordings.list`)).json();
const byTitle = Object.fromEntries((list.result.data.json ?? list.result.data).map((r) => [r.title, r.id]));
const id = (title) => {
  if (!byTitle[title]) throw new Error(`Recording "${title}" not found. Run seed-library.mjs.`);
  return byTitle[title];
};

const go = async (page, path) => { await page.goto(BASE + path, { waitUntil: "networkidle" }); await page.waitForTimeout(800); };
const tab = async (page, name) => { await page.getByRole("tab", { name }).first().click(); await page.waitForTimeout(700); };
// Puts an element just under the sticky header (with a small gap).
const scrollUnderHeader = async (page, locator, gap = 20) => {
  await locator.first().evaluate((el, g) => {
    const header = [...document.querySelectorAll(".sticky.top-0")].find((e) => getComputedStyle(e).position === "sticky");
    const hb = header ? header.getBoundingClientRect().bottom : 0;
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - hb - g);
  }, gap);
  await page.waitForTimeout(400);
};
const settle = async (page) => { await page.mouse.move(0, 0); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300); };

mkdirSync(OUT, { recursive: true });
const shotFull = async (name) => {
  await settle(full);
  await full.screenshot({ path: resolve(OUT, `${name}.jpg`), type: "jpeg", quality: 86 });
  console.log("wrote", `${name}.jpg`);
};
const shotFocus = async (name, locator) => {
  await crop.evaluate(() => {
    for (const el of document.querySelectorAll(".sticky")) el.style.position = "relative";
  });
  await locator.first().scrollIntoViewIfNeeded();
  await settle(crop);
  // A sliver of the page around the card, so its border is not cut off (more would catch the tabs above).
  const box = await locator.first().boundingBox();
  const pad = 4;
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  const clip = { x, y, width: Math.min(CROP_VIEW.width - x, box.width + pad * 2), height: Math.min(CROP_VIEW.height - y, box.height + pad * 2) };
  await crop.screenshot({ path: resolve(OUT, `${name}-focus.jpg`), type: "jpeg", quality: 86, clip });
  console.log("wrote", `${name}-focus.jpg`);
};
// Runs the same steps on both pages, then saves the frame and the card.
// Pass frame: false when only the card is used on the site.
const both = async (name, steps, focus, { frame = true } = {}) => {
  for (const page of frame ? [full, crop] : [crop]) await steps(page);
  if (frame) await shotFull(name);
  if (focus) await shotFocus(name, focus(crop));
};

await both("dashboard", async (page) => {
  await go(page, "/dashboard");
  await scrollUnderHeader(page, page.getByPlaceholder("Search recordings..."));
});

const transcriptCard = (page) => page.locator("div.border-2", { has: page.getByText("Full Transcript", { exact: true }) }).last();
await both("transcript", async (page) => {
  await go(page, `/recording/${id("Thermodynamics, lecture 4")}`);
  await page.getByPlaceholder("Search this transcript").fill("entropy");
  await page.waitForTimeout(400);
  await scrollUnderHeader(page, page.getByPlaceholder("Search this transcript"));
});

await both("study-notes", async (page) => {
  await go(page, `/recording/${id("Intro to Microeconomics: Supply and Demand")}`);
  await tab(page, /Study Notes/);
  await scrollUnderHeader(page, page.locator("div.border-2", { has: page.getByText("Lecture notes", { exact: true }) }).last());
});

await both(
  "flashcards",
  async (page) => {
    await go(page, `/recording/${id("Intro to Artificial Intelligence")}`);
    await tab(page, /Flashcards/);
    await page.getByRole("button", { name: /Start review/ }).click();
    await page.waitForTimeout(600);
    await scrollUnderHeader(page, page.locator("div.border-2", { has: page.getByText("mastered") }).filter({ hasNot: page.getByText(/Card 1 of/) }).last());
  },
  (page) => page.locator("div.border-2", { has: page.getByText(/Card 1 of/) }).last(),
);

await both(
  "quiz",
  async (page) => {
    await go(page, `/recordings/${id("World History: Causes of World War I")}/quizzes`);
    await page.getByRole("button", { name: /Start Quiz/ }).first().click();
    await page.waitForTimeout(700);
  },
  (page) => page.locator("div", { has: page.getByText("What does the acronym MAIN stand for?") }).filter({ has: page.getByRole("button", { name: "Next" }) }).last(),
  { frame: false },
);

await both(
  "study-guide",
  async (page) => {
    await go(page, `/recordings/${id("Organic Chemistry: SN1 vs SN2 Reactions")}/study-guides`);
    await page.getByText("Study Guide: SN1 vs SN2").first().click();
    await page.waitForTimeout(700);
  },
  (page) =>
    page
      .locator("div", { has: page.getByRole("heading", { name: "Overview" }) })
      .filter({ has: page.getByRole("heading", { name: "Review Questions" }) })
      .last(),
  { frame: false },
);

const tutorCard = (page) => page.locator("div.border-2", { has: page.getByText(/AI Tutor - Ask questions/) }).last();
await both(
  "ai-tutor",
  async (page) => {
    await go(page, `/recording/${id("Intro to Psychology: Classical Conditioning")}`);
    await tab(page, /AI Assistant/);
    await scrollUnderHeader(page, tutorCard(page));
  },
  tutorCard,
  { frame: false },
);

await both("email-drafts", async (page) => {
  await go(page, `/recordings/${id("Q3 Product Roadmap Sync")}/email-drafts`);
  await page.getByText("Email Summary: Q3 Product Roadmap Sync").first().click();
  await page.waitForTimeout(700);
  // In a narrow window the opened email sits below the list of drafts.
  await scrollUnderHeader(page, page.getByRole("button", { name: /^Copy$/ }).locator("xpath=ancestor::div[contains(@class,'border')][1]"));
});

await browser.close();

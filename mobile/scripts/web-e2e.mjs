#!/usr/bin/env node
/**
 * Drives the app's web build in Chromium at iPhone size (390x844) against a
 * local server with the demo library (scripts/demo-video/v2/seed-library.mjs),
 * checking the main flows and saving a screenshot of each screen.
 *
 *   node scripts/web-e2e.mjs [baseUrl] [outDir]
 * Needs Playwright. A global install works too:
 *   PLAYWRIGHT_MODULE=$(npm root -g)/playwright/index.js node scripts/web-e2e.mjs
 */
import { mkdirSync } from "node:fs";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const chromium = playwright.chromium ?? playwright.default.chromium;

const base = process.argv[2] || "http://localhost:8099";
const out = process.argv[3] || "screenshots";
const email = process.env.DEMO_USER_EMAIL || "demo@example.com";
const password = process.env.DEMO_USER_PASSWORD || "demo-password-1";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: process.env.SCHEME === "dark" ? "dark" : "light", isMobile: true, hasTouch: true });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !/favicon|Download the React DevTools/.test(message.text())) problems.push(`console: ${message.text()}`);
});
const results = [];
async function step(name, action) {
  try {
    await action();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${name}.png` });
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${error.message.split("\n")[0]}`);
    await page.screenshot({ path: `${out}/${name}-FAILED.png` }).catch(() => undefined);
  }
}
const text = (value) => page.getByText(value, { exact: false }).first();

await step("01-login", async () => {
  await page.goto(base);
  await text("Welcome back").waitFor({ timeout: 30000 });
});
await step("02-login-error", async () => {
  await page.getByLabel("Email").first().fill(email);
  await page.getByLabel("Password").first().fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await text("Invalid email or password").waitFor();
});
await step("03-library", async () => {
  await page.getByLabel("Password").first().fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await text("Library").waitFor({ timeout: 20000 });
  await text("Cell Biology").waitFor({ timeout: 20000 });
});
await step("04-library-search", async () => {
  await page.getByLabel("Search recordings").fill("spanish");
  await text("Spanish").waitFor();
});
await step("05-record", async () => {
  await page.getByLabel("Search recordings").fill("");
  await page.getByRole("tab", { name: "Record" }).first().click().catch(() => page.getByText("Record", { exact: true }).last().click());
  await text("Only record with permission").waitFor();
});
await step("06-upload", async () => {
  await page.getByRole("tab", { name: "Upload" }).click();
  await text("Choose an audio or video file").waitFor();
});
await step("07-link", async () => {
  await page.getByRole("tab", { name: "Link" }).click();
  await text("Link to audio or video").waitFor();
});
await step("08-recording-transcript", async () => {
  await page.goto(`${base}/recording/1`);
  await text("Mitochondria").waitFor({ timeout: 20000 });
  await text("Transcript").waitFor();
});
await step("09-transcript-search", async () => {
  await page.getByLabel("Search the transcript").fill("ATP");
  await text("matches").waitFor();
});
await step("10-recording-notes", async () => {
  await page.getByRole("tab", { name: "Notes" }).click();
  await text("Generate notes").waitFor();
});
await step("11-recording-study", async () => {
  await page.getByRole("tab", { name: "Study" }).click();
  await text("Flashcards").waitFor();
});
await step("12-flashcards", async () => {
  await page.goto(`${base}/recording/1/flashcards`);
  await text("Show answer").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Show answer" }).click();
  await text("I knew it").waitFor();
});
await step("13-quiz", async () => {
  await page.goto(`${base}/recording/1/quiz`);
  await text("Your quizzes").waitFor({ timeout: 20000 });
});
await step("14-guide", async () => {
  await page.goto(`${base}/recording/1/guide`);
  await page.waitForTimeout(1500);
});
await step("15-tutor", async () => {
  await page.goto(`${base}/recording/1/tutor`);
  await page.getByLabel("Ask about this recording").waitFor({ timeout: 20000 });
});
await step("16-ask", async () => {
  await page.goto(`${base}/ask`);
  await page.getByLabel("Ask about anything you recorded").fill("What do mitochondria produce?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForSelector("text=/\\[1\\]|could not find/", { timeout: 30000 });
});
await step("17-tasks", async () => {
  await page.goto(`${base}/tasks`);
  await text("Tasks").waitFor({ timeout: 20000 });
});
await step("18-settings", async () => {
  await page.goto(`${base}/settings`);
  await text("Delete account").waitFor({ timeout: 20000 });
});
await step("19-plan", async () => {
  await page.goto(`${base}/plan`);
  await text("This month").waitFor({ timeout: 20000 });
  if (await page.getByText(/upgrade|subscribe|checkout|\$\d/i).count()) throw new Error("plan screen shows a purchase prompt");
});
await step("20-exam-packs", async () => {
  await page.goto(`${base}/exam-packs`);
  await text("New exam pack").waitFor({ timeout: 20000 });
});
await step("21-notifications", async () => {
  await page.goto(`${base}/notifications`);
  await page.waitForTimeout(1500);
});
await step("22-trash", async () => {
  await page.goto(`${base}/trash`);
  await page.waitForTimeout(1500);
});
await step("23-delete-account", async () => {
  await page.goto(`${base}/delete-account`);
  await text("This can't be undone").waitFor({ timeout: 20000 });
});
await step("24-signup", async () => {
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/signup?invite=NOTREAL123`);
  await text("Create your account").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Create account" }).click();
  await text("Confirm you are at least 13").waitFor();
});

console.log(results.join("\n"));
if (problems.length) console.log(`\nBrowser errors:\n${[...new Set(problems)].slice(0, 30).join("\n")}`);
await browser.close();
process.exit(results.some((line) => line.startsWith("FAIL")) ? 1 : 0);

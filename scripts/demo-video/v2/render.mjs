// Renders the demo one frame at a time with headless Chrome, then muxes the soundtrack.
//   node render.mjs <workdir> <out.mp4> [--stills t1,t2,...]
// <workdir> holds timeline.json and mix.wav from build_audio.py. Needs Google Chrome installed.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [work, out, flag, stillArg] = process.argv.slice(2);
const timeline = JSON.parse(readFileSync(resolve(work, "timeline.json"), "utf8"));
const FPS = 30;

const browser = await chromium.launch({ channel: "chrome", args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript((tl) => { window.__TL = tl; }, timeline);
await page.goto(pathToFileURL(resolve(here, "index.html")).href);
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
  await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
});

if (flag === "--stills") {
  for (const t of stillArg.split(",").map(Number)) {
    await page.evaluate((x) => window.renderAt(x), t);
    await page.screenshot({ path: resolve(work, `still_${t}.png`) });
  }
  await browser.close();
  process.exit(0);
}

const frames = Math.ceil(timeline.total * FPS);
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-i", resolve(work, "mix.wav"),
  "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", out], { stdio: ["pipe", "inherit", "inherit"] });
for (let n = 0; n < frames; n++) {
  await page.evaluate((t) => window.renderAt(t), n / FPS);
  const buf = await page.screenshot({ type: "jpeg", quality: 93 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (n % 150 === 0) console.log(`frame ${n}/${frames}`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log("done", out);

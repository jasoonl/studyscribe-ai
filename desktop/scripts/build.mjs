#!/usr/bin/env node
/** Bundles the main process and the preload script into dist/ for Electron and electron-builder. */
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
rmSync(join(root, "dist"), { recursive: true, force: true });

const common = {
  absWorkingDir: root,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // electron is provided at runtime; electron-updater is loaded from the packaged node_modules only when updates are on.
  external: ["electron", "electron-updater"],
  sourcemap: "linked",
  logLevel: "warning",
};

await build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.js" });
// A sandboxed preload can only require "electron"; everything else is bundled in.
await build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.js" });
console.log("Built dist/main.js and dist/preload.js");

#!/usr/bin/env node
/**
 * Builds the extension into dist/ (load it unpacked from there) and packs
 * release/studyscribe-extension-<version>.zip for the Chrome Web Store.
 *
 *   node scripts/build.mjs                                   production build
 *   node scripts/build.mjs --dev-origin=http://localhost:3107  also grants that
 *     local server and makes it the default site (for development and the e2e test)
 */
import { build } from "esbuild";
import { zipSync } from "fflate";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const release = join(root, "release");
const devOriginArg = process.argv.find(arg => arg.startsWith("--dev-origin="));
const devOrigin = devOriginArg ? devOriginArg.slice("--dev-origin=".length) : process.env.STUDYSCRIBE_DEV_ORIGIN || "";
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ["src/background.ts", "src/popup.ts", "src/options.ts", "src/offscreen.ts", "src/permission.ts"],
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "chrome116",
  minify: !devOrigin,
  sourcemap: devOrigin ? "inline" : false,
  legalComments: "none",
  define: { __DEFAULT_ORIGIN__: JSON.stringify(devOrigin || "") },
  logLevel: "warning",
});

// The manifest is TypeScript so it can share the origin helpers; bundle it in memory and evaluate it.
const manifestModule = await build({
  absWorkingDir: root,
  entryPoints: ["src/manifest.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "warning",
});
const tmp = join(root, "node_modules", ".manifest-build.mjs");
writeFileSync(tmp, manifestModule.outputFiles[0].text);
const { buildManifest } = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`);
rmSync(tmp);
writeFileSync(join(dist, "manifest.json"), `${JSON.stringify(buildManifest({ version, devOrigin: devOrigin || undefined }), null, 2)}\n`);

cpSync(join(root, "static"), dist, { recursive: true });

function filesUnder(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const entries = Object.fromEntries(filesUnder(dist).map(path => [relative(dist, path).split("\\").join("/"), readFileSync(path)]));
mkdirSync(release, { recursive: true });
const zipName = `studyscribe-extension-${version}${devOrigin ? "-dev" : ""}.zip`;
writeFileSync(join(release, zipName), zipSync(entries, { level: 9 }));

const kb = n => `${(n / 1024).toFixed(0)} KB`;
const total = Object.values(entries).reduce((sum, data) => sum + data.length, 0);
console.log(`Built dist/ (${Object.keys(entries).length} files, ${kb(total)}) and release/${zipName}${devOrigin ? ` for ${devOrigin}` : ""}`);

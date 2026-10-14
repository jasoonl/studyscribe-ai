#!/usr/bin/env node
/**
 * Serves the app's web export (react-native-web) and proxies /api to a local
 * StudyScribe server, so the app can be tested in a browser at phone sizes
 * without CORS. Testing aid only; the web build never ships.
 *
 *   npx expo export -p web --output-dir dist-web
 *   API_TARGET=http://127.0.0.1:3100 PORT=8099 node scripts/web-preview.mjs
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] || "dist-web");
const port = Number(process.env.PORT || 8099);
const target = new URL(process.env.API_TARGET || "http://127.0.0.1:3100");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") {
    const upstream = request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", () => {
      res.writeHead(502);
      res.end("API unavailable");
    });
    req.pipe(upstream);
    return;
  }
  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`App preview on http://localhost:${port} (API: ${target.origin})`));

import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

// One id per build. The service worker is registered as /studyscribe-push-sw.js?v=<id>, so
// each deploy installs a fresh worker that caches that build's files (offline use, Phase 7).
const BUILD_ID = Date.now().toString(36);

/** Lists the built JS and CSS for the service worker to cache when it installs. */
function offlineAssetList(): Plugin {
  return {
    name: "studyscribe-offline-assets",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((file) => /\.(js|css)$/.test(file))
        .map((file) => `/${file}`)
        .sort();
      this.emitFile({ type: "asset", fileName: "sw-assets.json", source: JSON.stringify({ build: BUILD_ID, files }) });
    },
  };
}

export default defineConfig(({ command }) => ({
  // jsx-loc tags elements with their source file and line, a development aid that
  // would otherwise ship file paths and extra bytes to every visitor.
  plugins: [react(), tailwindcss(), offlineAssetList(), ...(command === "serve" ? [jsxLocPlugin()] : [])],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    hmr: false,
    fs: {
      strict: true,
      deny: ["**/..*"],
    },
  },
}));

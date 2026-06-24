import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  
  // Catch-all for client-side routes (but not API routes)
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    
    // Skip API routes and static assets
    if (url.startsWith('/api/') || url.startsWith('/manus-storage/')) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // Try multiple possible paths for dist/public
  const possiblePaths = [
    path.resolve(import.meta.dirname, "../../dist/public"),
    path.resolve(process.cwd(), "dist/public"),
    "/app/dist/public",
  ];

  let distPath = possiblePaths[0];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      distPath = p;
      console.log(`Found dist/public at: ${distPath}`);
      break;
    }
  }

  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory. Tried: ${possiblePaths.join(", ")}`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist (but not API routes)
  app.use("*", (req, res) => {
    // Skip API routes
    if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/manus-storage/')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const indexPath = path.resolve(distPath, "index.html");
    if (!fs.existsSync(indexPath)) {
      console.error(`index.html not found at: ${indexPath}`);
      res.status(404).json({ error: 'index.html not found' });
      return;
    }
    res.sendFile(indexPath);
  });
}

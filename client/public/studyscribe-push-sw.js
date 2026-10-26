// StudyScribe's service worker: browser push (since Phase 1) and offline use (Phase 7).
// Registered as /studyscribe-push-sw.js?v=<build id> (client/src/lib/serviceWorker.ts);
// keep the file name, because existing push subscriptions belong to this registration.

const BUILD = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `studyscribe-app-${BUILD}`;
const SHELL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // The page shell, then every built JS and CSS file, so any page opens offline.
      // Best effort: one missing file must not stop the worker installing.
      await cache.add(new Request(SHELL, { cache: "reload" })).catch(() => {});
      try {
        const list = await fetch("/sw-assets.json", { cache: "no-store" });
        if (list.ok) {
          const { files } = await list.json();
          await Promise.all((files || []).map((file) => precache(cache, file)));
        }
      } catch {
        // Development has no asset list; files are cached as they load instead.
      }
      await self.skipWaiting();
    })(),
  );
});

function isAppPage(response) {
  return (response.headers.get("content-type") || "").includes("text/html");
}

async function precache(cache, file) {
  try {
    const response = await fetch(file);
    if (response.ok && !isAppPage(response)) await cache.put(file, response);
  } catch {
    // Skipped: it is fetched and cached when first used instead.
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("studyscribe-app-") && name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Account data, audio and anything private always goes to the network and is never cached here.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/manus-storage/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(SHELL, response.clone());
          }
          return response;
        } catch {
          return (await caches.match(SHELL)) || Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    // Built files have a content hash in their name, so a cached copy never goes stale.
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached && !isAppPage(cached)) return cached;
        const response = await fetch(request);
        // A file from an older deploy comes back as the app page (the host's fallback). Never keep
        // that under the file's name, or every later visit would load a page instead of code.
        if (isAppPage(response)) return new Response("Not found", { status: 404 });
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  const fallback = {
    title: "StudyScribe AI",
    body: "You have a new notification.",
    url: "/dashboard",
    tag: "studyscribe-notification",
  };

  let payload = fallback;
  try {
    payload = { ...fallback, ...(event.data ? event.data.json() : {}) };
  } catch {
    // Display the generic notification if a malformed push payload is received.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url },
      icon: "/favicon.ico",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = event.notification.data?.url || "/dashboard";
  event.waitUntil(clients.openWindow(new URL(destination, self.location.origin).href));
});

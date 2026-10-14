// The one place the service worker is registered (push and offline use). The build id in
// the URL makes every deploy install a fresh worker that caches its own files.

const BUILD = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
export const SERVICE_WORKER_URL = `/studyscribe-push-sw.js?v=${BUILD}`;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SERVICE_WORKER_URL);
}

/** Registers on load in production so the app opens offline; development keeps Vite's live files uncached. */
export function registerServiceWorkerForOffline() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || import.meta.env.DEV) return;
  const start = () => void registerServiceWorker().catch((error) => console.warn("[offline] service worker not registered:", error));
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

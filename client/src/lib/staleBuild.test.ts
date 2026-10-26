import { describe, expect, it } from "vitest";
import { isChunkLoadError, mayReloadForUpdate, STALE_BUILD_RELOAD_KEY } from "./staleBuild";

describe("isChunkLoadError", () => {
  it("recognises each browser's failed page-file import", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/Notes-1.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: https://x/assets/Notes-1.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/Notes-1.css"))).toBe(true);
  });

  it("leaves ordinary errors alone", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("mayReloadForUpdate", () => {
  const store = (value: string | null) => ({ getItem: (key: string) => (key === STALE_BUILD_RELOAD_KEY ? value : null) });

  it("allows the first reload", () => {
    expect(mayReloadForUpdate(1_000_000, store(null))).toBe(true);
  });

  it("refuses a second reload within a minute, so a missing file cannot loop", () => {
    expect(mayReloadForUpdate(1_000_000, store(String(1_000_000 - 5_000)))).toBe(false);
    expect(mayReloadForUpdate(1_000_000, store(String(1_000_000 - 61_000)))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { formatBytes } from "./formatBytes";

const format = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat("en", options).format(value);

describe("formatBytes", () => {
  it("scales to B, KB and MB", () => {
    expect(formatBytes(512, format)).toBe("512 B");
    expect(formatBytes(2048, format)).toBe("2 KB");
    expect(formatBytes(3.4 * 1024 * 1024, format)).toBe("3.4 MB");
    expect(formatBytes(25 * 1024 * 1024, format)).toBe("25 MB");
  });
  it("returns nothing for nonsense", () => {
    expect(formatBytes(-1)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
  });
});

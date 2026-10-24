import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../shared/i18n/en";
import es from "../../../shared/i18n/es";
import fr from "../../../shared/i18n/fr";
import ja from "../../../shared/i18n/ja";
import ko from "../../../shared/i18n/ko";
import zh from "../../../shared/i18n/zh";
import { placeholders } from "../../../shared/i18n";

const ours = Object.keys(en).filter(key => /^(practice|mistakes)\./.test(key));

describe("practice and mistakes messages", () => {
  it("exist in all six languages with the same placeholders", () => {
    expect(ours.length).toBeGreaterThan(80);
    for (const [code, messages] of Object.entries({ es, fr, zh, ja, ko })) {
      for (const key of ours) {
        const text = (messages as Record<string, string>)[key];
        expect(text, `${code} ${key}`).toBeTruthy();
        expect(placeholders(text), `${code} ${key}`).toEqual(placeholders((en as Record<string, string>)[key]));
      }
    }
  });
  it("has both plural forms for every counted message", () => {
    for (const key of ours.filter(k => k.endsWith("_one"))) expect(ours).toContain(key.replace(/_one$/, "_other"));
  });
  it("uses no em dashes, plan or price wording", () => {
    for (const key of ours) {
      const text = (en as Record<string, string>)[key];
      expect(text, key).not.toContain("—");
      expect(text, key).not.toMatch(/\b(upgrade|subscription|premium|\$)\b|plan\b/i);
    }
  });
  it("covers every key the screens ask for", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) files.push(full);
      }
    };
    walk(root);
    const used = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/"((?:practice|mistakes)\.[A-Za-z0-9_.]+)"/g)) used.add(match[1]);
    }
    const missing = Array.from(used).filter(key => !(key in en) && !((`${key}_other`) in en));
    expect(missing).toEqual([]);
  });
});

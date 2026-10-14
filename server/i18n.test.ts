import { describe, expect, it } from "vitest";
import en from "../shared/i18n/en";
import es from "../shared/i18n/es";
import fr from "../shared/i18n/fr";
import ja from "../shared/i18n/ja";
import ko from "../shared/i18n/ko";
import zh from "../shared/i18n/zh";
import { interpolate, matchUiLanguage, placeholders, pluralSuffix, tags, UI_LANGUAGES } from "../shared/i18n";

const translations = { es, fr, zh, ja, ko };

describe("interface translations", () => {
  it("covers every language offered", () => {
    expect(Object.keys(translations).sort()).toEqual(UI_LANGUAGES.map((l) => l.code).filter((c) => c !== "en").sort());
  });

  for (const [code, messages] of Object.entries(translations)) {
    it(`${code} has every message, no extras, and keeps placeholders and links`, () => {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
      for (const [key, source] of Object.entries(en)) {
        const text = messages[key as keyof typeof en];
        expect(text.trim(), `${code} ${key} is empty`).not.toBe("");
        expect(placeholders(text), `${code} ${key} placeholders`).toEqual(placeholders(source));
        expect(tags(text), `${code} ${key} links`).toEqual(tags(source));
      }
    });
  }

  it("English copy follows the house rules (no em dashes)", () => {
    for (const [code, messages] of Object.entries({ en, ...translations })) {
      for (const [key, text] of Object.entries(messages)) expect(text, `${code} ${key}`).not.toContain("—");
    }
  });
});

describe("language helpers", () => {
  it("matches the browser's preferences by primary subtag", () => {
    expect(matchUiLanguage(["es-MX", "en"])).toBe("es");
    expect(matchUiLanguage(["zh-TW"])).toBe("zh");
    expect(matchUiLanguage(["de-DE", "ko-KR"])).toBe("ko");
    expect(matchUiLanguage(["de"])).toBe("en");
    expect(matchUiLanguage([])).toBe("en");
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    expect(interpolate("{count} recordings", { count: 3 })).toBe("3 recordings");
    expect(interpolate("Hi {name}", {})).toBe("Hi {name}");
  });

  it("uses each language's plural rules", () => {
    expect(pluralSuffix("en", 1)).toBe("one");
    expect(pluralSuffix("en", 2)).toBe("other");
    expect(pluralSuffix("fr", 0)).toBe("one");
    expect(pluralSuffix("ja", 1)).toBe("other");
  });
});

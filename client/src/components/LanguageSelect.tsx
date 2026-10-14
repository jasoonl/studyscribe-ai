import { AUTO_LANGUAGE, TRANSCRIPTION_LANGUAGES } from "@shared/languages";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getUiLanguage, t, useI18n } from "@/i18n";
import { htmlLangFor } from "@shared/i18n";

/** A language's name in the interface language, falling back to the English label. */
function languageName(code: string, fallback: string) {
  if (code === "zh") return t("fields.language.zh");
  try {
    const name = new Intl.DisplayNames([htmlLangFor(getUiLanguage())], { type: "language" }).of(code);
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(htmlLangFor(getUiLanguage())) + name.slice(1);
  } catch {
    // Older browsers without Intl.DisplayNames keep the English name.
  }
  return fallback;
}

/** "auto" is sent to the server as no language at all, so the provider detects it. */
export function languageForRequest(value: string): string | undefined {
  return value === AUTO_LANGUAGE ? undefined : value;
}

export default function LanguageSelect({
  value,
  onChange,
  id = "transcription-language",
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  useI18n();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("fields.language.label")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_LANGUAGE}>{t("fields.language.auto")}</SelectItem>
          {TRANSCRIPTION_LANGUAGES.map((language) => (
            <SelectItem key={language.code} value={language.code}>
              {languageName(language.code, language.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t("fields.language.help")}</p>
    </div>
  );
}

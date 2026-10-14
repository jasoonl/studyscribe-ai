import { UI_LANGUAGES, isUiLanguage } from "@shared/i18n";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/** Chooses the interface language. Each name is written in its own language so anyone can find theirs. */
export function LanguagePicker({ id = "ui-language", className, showLabel = false }: { id?: string; className?: string; showLabel?: boolean }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <label htmlFor={id} className={showLabel ? "text-sm text-muted-foreground" : "sr-only"}>
        {t("language.label")}
      </label>
      <select
        id={id}
        value={language}
        onChange={(event) => {
          if (isUiLanguage(event.target.value)) void setLanguage(event.target.value);
        }}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {UI_LANGUAGES.map((option) => (
          <option key={option.code} value={option.code} lang={option.htmlLang}>
            {option.name}
          </option>
        ))}
      </select>
    </span>
  );
}

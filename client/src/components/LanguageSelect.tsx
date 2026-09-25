import { AUTO_LANGUAGE, TRANSCRIPTION_LANGUAGES } from "@shared/languages";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Spoken language</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_LANGUAGE}>Detect automatically</SelectItem>
          {TRANSCRIPTION_LANGUAGES.map((language) => (
            <SelectItem key={language.code} value={language.code}>
              {language.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Automatic works for most audio. Pick a language if the transcript comes out in the wrong one.</p>
    </div>
  );
}

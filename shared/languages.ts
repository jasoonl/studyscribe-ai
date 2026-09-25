/**
 * Spoken languages the transcription provider (AssemblyAI) accepts as an explicit
 * `language_code`. Leaving the choice on "auto" lets it detect the language, which is
 * right for most audio; picking one is the fix when detection guesses wrong (short clips,
 * accented speech, or languages it mistakes for a neighbour such as Latin).
 * Cantonese is not offered by the provider: it is transcribed as Chinese (`zh`).
 */
export const TRANSCRIPTION_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh", label: "Chinese (Mandarin; also used for Cantonese)" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ko", label: "Korean" },
  { code: "la", label: "Latin" },
  { code: "ja", label: "Japanese" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "tr", label: "Turkish" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "uk", label: "Ukrainian" },
  { code: "sv", label: "Swedish" },
  { code: "el", label: "Greek" },
  { code: "he", label: "Hebrew" },
  { code: "th", label: "Thai" },
  { code: "fa", label: "Persian" },
  { code: "ta", label: "Tamil" },
  { code: "ur", label: "Urdu" },
  { code: "tl", label: "Tagalog" },
] as const;

export const TRANSCRIPTION_LANGUAGE_CODES = TRANSCRIPTION_LANGUAGES.map((l) => l.code) as [string, ...string[]];
export const AUTO_LANGUAGE = "auto";

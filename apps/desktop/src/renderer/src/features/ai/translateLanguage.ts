import { readStored } from "../../lib/storage";

/** Where the Translation settings page remembers the default language (settings.ai has no field for it). */
export const TRANSLATE_LANGUAGE_STORAGE_KEY = "flint.ai.translateLanguage";

/** The language name for the system locale, "English" when it can't be told. */
export function systemLanguageName(locale: string = typeof navigator === "undefined" ? "en" : navigator.language): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(locale.split("-")[0] ?? "en") ?? "English";
  } catch {
    return "English";
  }
}

/** The language the user reads: their saved Translate default, else the system language. */
export function userLanguage(): string {
  const saved = readStored(TRANSLATE_LANGUAGE_STORAGE_KEY);
  return saved && saved.trim() ? saved.trim() : systemLanguageName();
}

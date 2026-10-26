import type { AddCalDavAccountInput, CalDavPreset } from "@flint/core/types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CalendarKind = "google" | "icloud" | "fastmail" | "other";

export const KIND_LABEL: Record<CalendarKind, string> = {
  google: "Google Calendar",
  icloud: "iCloud Calendar",
  fastmail: "Fastmail Calendar",
  other: "CalDAV calendar",
};

export const APPLE_PASSWORDS_URL = "https://appleid.apple.com/account/manage";
export const FASTMAIL_PASSWORDS_URL = "https://app.fastmail.com/settings/security/devicekeys";

export type AddressesCheck = { ok: true; values: string[] } | { ok: false; message: string };

/** Splits "a@x.com, b@x.com" on commas, spaces and semicolons; lower-cases, drops repeats and anything in `exclude`. */
export function parseAddresses(raw: string, exclude: readonly string[] = []): AddressesCheck {
  const skip = new Set(exclude.map((a) => a.toLowerCase()));
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,;]+/).filter(Boolean)) {
    const value = part.toLowerCase();
    if (!EMAIL.test(value)) return { ok: false, message: `"${part}" is not a full email address.` };
    if (!skip.has(value)) seen.add(value);
  }
  return { ok: true, values: [...seen] };
}

export type CalDavForm = { kind: Exclude<CalendarKind, "google">; url: string; username: string; password: string; addresses: string };
export type CalDavErrors = Partial<Record<"url" | "username" | "password" | "addresses", string>>;

/** Checks a CalDAV form and builds the API input. Returns the first problem per field. */
export function buildCalDavInput(f: CalDavForm): { input: AddCalDavAccountInput; errors?: undefined } | { input?: undefined; errors: CalDavErrors } {
  const errors: CalDavErrors = {};
  const url = f.url.trim();
  if (f.kind === "other") {
    if (!url) errors.url = "Enter the server address.";
    else if (!/^https:\/\/[^\s/]+/i.test(url)) errors.url = "The server address must start with https://.";
  }
  if (!f.username.trim()) errors.username = f.kind === "icloud" ? "Enter your Apple ID." : "Enter the username.";
  if (!f.password) errors.password = f.kind === "other" ? "Enter the password." : "Enter an app-specific password.";
  const extra = parseAddresses(f.addresses, [f.username]);
  if (!extra.ok) errors.addresses = extra.message;
  if (Object.keys(errors).length > 0 || !extra.ok) return { errors };
  const input: AddCalDavAccountInput = {
    ...(f.kind === "other" ? { url } : { preset: f.kind as CalDavPreset }),
    username: f.username.trim(),
    password: f.password,
    ...(extra.values.length > 0 ? { extraAddresses: extra.values } : {}),
  };
  return { input };
}

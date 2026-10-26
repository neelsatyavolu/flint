export type Mode = "all" | "commands" | "mail" | "contacts" | "folders";

export const MODE_PREFIX: Record<Exclude<Mode, "all">, string> = { commands: ">", mail: "/", contacts: "@", folders: "#" };

const BY_PREFIX: Record<string, Exclude<Mode, "all">> = { ">": "commands", "/": "mail", "@": "contacts", "#": "folders" };

/** A leading ">", "/", "@" or "#" picks a mode; the rest of the line is the text to match. */
export function parseQuery(raw: string): { mode: Mode; text: string } {
  const mode = BY_PREFIX[raw[0] ?? ""];
  if (!mode) return { mode: "all", text: raw.trim() };
  return { mode, text: raw.slice(1).trim() };
}

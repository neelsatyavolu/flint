/** Electron accelerators for the autofill shortcut: capture from a keydown, and show as Mac symbols. */

const NAMED_KEYS: Record<string, string> = {
  Space: "Space", Enter: "Return", Tab: "Tab", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
};

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return NAMED_KEYS[code] ?? null;
}

type KeyLike = Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

/** "Control+Option+V" from a keydown, or null while only modifiers are down, the key is unsupported, or no modifier is held. */
export function acceleratorFromEvent(e: KeyLike): string | null {
  const key = keyName(e.code);
  if (!key) return null;
  const mods = [e.ctrlKey && "Control", e.altKey && "Option", e.shiftKey && "Shift", e.metaKey && "Command"].filter(Boolean) as string[];
  if (mods.length === 0) return null;
  return [...mods, key].join("+");
}

const GLYPHS: Record<string, string> = { Control: "⌃", Ctrl: "⌃", Option: "⌥", Alt: "⌥", Shift: "⇧", Command: "⌘", Cmd: "⌘", Super: "⌘" };

/** "Control+Option+V" -> "⌃⌥V". */
export function formatAccelerator(accelerator: string): string {
  return accelerator.split("+").map((p) => GLYPHS[p] ?? p).join("");
}

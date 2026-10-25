/**
 * Keyboard shortcut registry. Combos are strings:
 *   "e"  "shift+z"  "mod+k"  "mod+shift+z"  "mod+Enter"  "?"  "#"  "Escape"  "g i" (sequence)
 * `mod` is Command on macOS and Control elsewhere. Events from inputs, textareas, selects and
 * contenteditable are ignored unless the binding sets `allowInInput`. Later registrations win;
 * a handler returning false passes the event on to earlier ones.
 */

export type ShortcutHandler = (event: KeyboardEvent) => void | false;
export type ShortcutOptions = { allowInInput?: boolean; preventDefault?: boolean; when?: () => boolean };
export type ShortcutRegistry = {
  register(combo: string | string[], handler: ShortcutHandler, options?: ShortcutOptions): () => void;
  /** Feed one keyboard event; returns true when a binding handled it. */
  dispatch(event: KeyboardEvent): boolean;
  attach(target: EventTarget): () => void;
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "OS"]);
const NAMED: Record<string, string> = { esc: "Escape", space: " ", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", return: "Enter", del: "Delete" };
const SEQUENCE_TIMEOUT_MS = 1000;

type Binding = { steps: string[]; handler: ShortcutHandler; options: ShortcutOptions };

export function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const host = (globalThis as { flintHost?: { platform?: string } }).flintHost?.platform;
  if (host) return host === "darwin";
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

function normalizeKey(raw: string): string {
  const named = NAMED[raw.toLowerCase()];
  if (named) return named;
  return raw.length === 1 ? raw.toLowerCase() : raw;
}

function splitStep(step: string): { mods: Set<string>; key: string } {
  let key = step;
  let modPart = "";
  if (step.endsWith("++")) {
    key = "+";
    modPart = step.slice(0, -2);
  } else if (step.length > 1) {
    const i = step.lastIndexOf("+");
    if (i > 0) {
      key = step.slice(i + 1);
      modPart = step.slice(0, i);
    }
  }
  return { mods: new Set(modPart.split("+").filter(Boolean).map((m) => m.toLowerCase())), key };
}

/** "Mod+Shift+Z" -> "mod+shift+z" in canonical order mod, ctrl, alt, shift, key. */
export function parseStep(step: string): string {
  const { mods, key } = splitStep(step);
  return describe({
    mod: mods.has("mod") || mods.has("cmd") || mods.has("meta"),
    ctrl: mods.has("ctrl"),
    alt: mods.has("alt") || mods.has("option"),
    shift: mods.has("shift"),
    key: normalizeKey(key),
  });
}

export function parseCombo(combo: string): string[] {
  return combo.trim().split(/\s+/).map(parseStep);
}

function describe(p: { mod: boolean; ctrl: boolean; alt: boolean; shift: boolean; key: string }): string {
  const shiftMatters = p.key.length > 1 || /^[a-z]$/.test(p.key) || p.mod || p.ctrl || p.alt;
  return [p.mod && "mod", p.ctrl && "ctrl", p.alt && "alt", p.shift && shiftMatters && "shift", p.key].filter(Boolean).join("+");
}

export function describeEvent(e: KeyboardEvent, isMac: boolean): string {
  const modPressed = isMac ? e.metaKey : e.ctrlKey;
  return describe({
    mod: modPressed,
    ctrl: isMac ? e.ctrlKey : false,
    alt: e.altKey,
    shift: e.shiftKey,
    key: normalizeKey(e.key),
  });
}

/** Containers inside which single-key shortcuts never fire, whatever element inside has focus. */
const EDITABLE_SCOPES = [
  "[data-inline-reply-mount]",
  "[data-composer]",
  '[contenteditable]:not([contenteditable="false"])',
  ".ProseMirror",
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]:not([aria-label="Conversations"])',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="searchbox"]',
].join(",");

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable === true || el.getAttribute?.("contenteditable") === "true") return true;
  return typeof el.closest === "function" && el.closest(EDITABLE_SCOPES) !== null;
}

/** The event target, or the focused element when the event was dispatched on body/document. */
function eventScopeTarget(event: KeyboardEvent): EventTarget | null {
  if (isEditableTarget(event.target)) return event.target;
  const active = typeof document !== "undefined" ? document.activeElement : null;
  return active && active !== document.body ? active : event.target;
}

export function createShortcutRegistry(opts: { isMac?: boolean; now?: () => number } = {}): ShortcutRegistry {
  const isMac = opts.isMac ?? detectMac();
  const now = opts.now ?? (() => Date.now());
  const bindings: Binding[] = [];
  let buffer: string[] = [];
  let lastAt = 0;

  const eligible = (b: Binding, editable: boolean) =>
    (!editable || b.options.allowInInput === true) && (b.options.when ? b.options.when() : true);

  function fire(match: Binding[], event: KeyboardEvent): boolean {
    for (let i = match.length - 1; i >= 0; i--) {
      const b = match[i]!;
      if (b.handler(event) !== false) {
        if (b.options.preventDefault !== false) event.preventDefault();
        return true;
      }
    }
    return false;
  }

  function dispatch(event: KeyboardEvent): boolean {
    if (event.isComposing || MODIFIER_KEYS.has(event.key)) return false;
    const editable = isEditableTarget(eventScopeTarget(event));
    const d = describeEvent(event, isMac);
    const t = now();
    if (t - lastAt > SEQUENCE_TIMEOUT_MS) buffer = [];
    lastAt = t;

    const live = bindings.filter((b) => eligible(b, editable));
    for (const attempt of [[...buffer, d], [d]]) {
      const exact = live.filter((b) => b.steps.length === attempt.length && b.steps.every((s, i) => s === attempt[i]));
      if (exact.length > 0 && fire(exact, event)) {
        buffer = [];
        return true;
      }
      const isPrefix = live.some((b) => b.steps.length > attempt.length && attempt.every((s, i) => b.steps[i] === s));
      if (isPrefix) {
        buffer = attempt;
        return true;
      }
      if (buffer.length === 0) break;
    }
    buffer = [];
    return false;
  }

  return {
    register(combo, handler, options = {}) {
      const combos = Array.isArray(combo) ? combo : [combo];
      const added = combos.map((c) => ({ steps: parseCombo(c), handler, options }));
      bindings.push(...added);
      return () => {
        for (const b of added) {
          const i = bindings.indexOf(b);
          if (i >= 0) bindings.splice(i, 1);
        }
      };
    },
    dispatch,
    attach(target) {
      const listener = (e: Event) => void dispatch(e as KeyboardEvent);
      target.addEventListener("keydown", listener);
      return () => target.removeEventListener("keydown", listener);
    },
  };
}

/** Display form for hints: "mod+k" -> "⌘K" (mac) or "Ctrl+K"; "g i" -> "G I". */
export function formatCombo(combo: string, isMac: boolean = detectMac()): string {
  const keyLabel = (k: string) =>
    ({ Escape: "Esc", Enter: "↵", Backspace: "⌫", Delete: "Del", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", " ": "Space" } as Record<string, string>)[k] ??
    (k.length === 1 ? k.toUpperCase() : k);
  return parseCombo(combo)
    .map((step) => {
      const { mods, key } = splitStep(step);
      if (isMac) {
        return `${mods.has("ctrl") ? "⌃" : ""}${mods.has("alt") ? "⌥" : ""}${mods.has("shift") ? "⇧" : ""}${mods.has("mod") ? "⌘" : ""}${keyLabel(key)}`;
      }
      return [mods.has("mod") && "Ctrl", mods.has("ctrl") && "Ctrl", mods.has("alt") && "Alt", mods.has("shift") && "Shift", keyLabel(key)].filter(Boolean).join("+");
    })
    .join(" ");
}

/** App-wide registry. UI code uses useShortcut(); the shell attaches it to document once. */
export const shortcuts = createShortcutRegistry();

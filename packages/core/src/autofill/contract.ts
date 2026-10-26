/**
 * FROZEN CONTRACT for system-wide code autofill. Two builders work against this file; change it only by agreement
 * (and bump HELPER_PROTOCOL_VERSION when the wire format changes incompatibly).
 *
 *   core detects a code -> CodeRegistry -> event {type:"code"}
 *     -> desktop main: AutofillManager (apps/desktop/src/main/autofill) sends the waiting codes to the helper
 *     -> FlintAutofill (apps/autofill-helper, Swift): watches the focused field through macOS Accessibility,
 *        shows a suggestion, types the code with CGEvent -> reports "used" -> manager calls markCodeUsed.
 *
 * Why Accessibility and no extension: AX works in every app and browser. Chromium browsers and Electron apps only
 * expose web content once AXManualAccessibility is set on their app element, which the helper does while a code is
 * waiting and undoes when none is.
 *
 * The Swift side mirrors every shape below by hand (Sources/FlintAutofillCore/Protocol.swift); the golden lines in
 * HELPER_PROTOCOL_FIXTURES are decoded by both the vitest contract test and the Swift tests, so they cannot drift.
 */
import { z } from "zod";
import type { AutofillStatus } from "../types";

export const HELPER_PROTOCOL_VERSION = 1;
/** Where the helper lives inside Flint.app (electron-builder extraResources "autofill/FlintAutofill"), and in development. */
export const HELPER_RESOURCE_PATH = "autofill/FlintAutofill";
export const HELPER_DEV_PATH = "apps/autofill-helper/dist/FlintAutofill";
/** Accessibility pane the helper opens (also usable from main with shell.openExternal). */
export const ACCESSIBILITY_PANE_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
/** Default accelerator for "type the newest code into the focused field". "" in settings turns it off. */
export const DEFAULT_AUTOFILL_SHORTCUT = "Control+Option+V";

/** One line is one UTF-8 JSON object terminated by "\n". Longer lines are a protocol error (the reader drops them). */
export const HELPER_MAX_LINE_BYTES = 64 * 1024;
/** Per-character delay while typing a code, milliseconds. The helper uses it between key-down/up pairs. */
export const HELPER_TYPE_DELAY_MS = 12;
/** The helper polls the focused element this often while a code is waiting (fallback next to AXObserver). */
export const HELPER_POLL_MS = 400;
/** Manager restart backoff after a crash: 1 s, 2 s, 4 s ... capped, give up (state "unavailable") after MAX attempts in a row. */
export const HELPER_RESTART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
export const HELPER_RESTART_MAX_ATTEMPTS = 6;
/** A helper run longer than this counts as healthy and resets the backoff. */
export const HELPER_HEALTHY_AFTER_MS = 60_000;

// ---------- main -> helper (stdin), field "op" ----------

/** A code the helper may offer. Same data as the codes socket's WireCode plus expiry; never thread, message or account ids. */
export const helperCodeSchema = z.object({
  id: z.string().min(1).max(100),
  code: z.string().min(1).max(64),
  service: z.string().max(200),
  /** Lower-case sender domain ("mail.kayak.com"); the helper matches it against the browser tab's host, best effort. */
  senderDomain: z.string().max(253),
  receivedAt: z.number(),
  /** ms epoch; the helper drops the code itself at this time even if main never says so. */
  expiresAt: z.number(),
});
export type HelperCode = z.infer<typeof helperCodeSchema>;

/** Screen rectangle in Electron/AX coordinates: origin at the top-left of the primary display, y down. */
export const screenRectSchema = z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() });
export type ScreenRect = z.infer<typeof screenRectSchema>;

export const helperCommandSchema = z.discriminatedUnion("op", [
  /** Report permission now (answers with a "permission" event). Never prompts. */
  z.object({ op: z.literal("status") }),
  /** The user clicked Enable: prompt (AXIsProcessTrustedWithOptions prompt:true) and, if openPane, open the Accessibility pane. */
  z.object({ op: z.literal("request_permission"), openPane: z.boolean() }),
  /** The complete list of waiting codes (unused, unexpired), newest first. Replaces the previous list; [] means none waiting, so the helper stops observing and restores AX attributes. */
  z.object({ op: z.literal("codes"), codes: z.array(helperCodeSchema).max(20) }),
  /** Global shortcut pressed: type the newest waiting code into the focused field, recognized or not. */
  z.object({ op: z.literal("type_newest") }),
  /** "Try it": show a suggestion with a fake code beside `field` (the demo window's input) regardless of what is focused. Clicking types it. */
  z.object({ op: z.literal("demo"), field: screenRectSchema, code: z.string().min(1).max(64), service: z.string().max(200) }),
  z.object({ op: z.literal("demo_stop") }),
  /** Restore AX attributes, remove the panel and exit 0. Sent on quit; closing stdin does the same. */
  z.object({ op: z.literal("shutdown") }),
]);
export type HelperCommand = z.infer<typeof helperCommandSchema>;

// ---------- helper -> main (stdout), field "event" ----------
// stdout carries only these lines. Diagnostics go to stderr and never contain codes.

export const FILL_METHODS = ["suggestion", "shortcut", "demo"] as const;
export const FILL_FAILURES = ["no_focus", "secure_input", "screen_locked", "no_permission", "type_failed", "expired"] as const;

export const helperEventSchema = z.discriminatedUnion("event", [
  /** First line after launch. `trusted` is the Accessibility state at launch. */
  z.object({ event: z.literal("ready"), protocol: z.number().int(), version: z.string(), pid: z.number().int(), trusted: z.boolean() }),
  /** Sent after "status", "request_permission", and whenever the helper notices the state changed (it re-checks every 2 s while idle). */
  z.object({ event: z.literal("permission"), trusted: z.boolean() }),
  /** Code `codeId` was typed into a field. via "demo" carries codeId "demo". Main marks the code used. */
  z.object({ event: z.literal("used"), codeId: z.string(), via: z.enum(FILL_METHODS), method: z.enum(["typed", "ax_value"]) }),
  z.object({ event: z.literal("fill_failed"), codeId: z.string(), reason: z.enum(FILL_FAILURES) }),
  /** Whether the helper is currently observing the focused element (true only while codes are waiting and permission is granted). Informational. */
  z.object({ event: z.literal("observing"), active: z.boolean() }),
  /** Non-fatal problem for the log. Must not contain codes or field contents. */
  z.object({ event: z.literal("error"), message: z.string().max(500) }),
]);
export type HelperEvent = z.infer<typeof helperEventSchema>;

/** Encodes one message as a protocol line (with the trailing newline). */
export function encodeLine(message: HelperCommand | HelperEvent): string {
  return `${JSON.stringify(message)}\n`;
}

/** Parses one line from the helper. Returns null for anything that is not a valid event (caller logs "bad helper line", never the line itself: it may hold a code). */
export function parseHelperEvent(line: string): HelperEvent | null {
  if (Buffer.byteLength(line) > HELPER_MAX_LINE_BYTES) return null;
  try {
    const parsed = helperEventSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Golden lines. The Swift tests read this JSON via Tests/.../Fixtures (copied by the contract test) so both sides decode the same bytes. */
export const HELPER_PROTOCOL_FIXTURES: { commands: HelperCommand[]; events: HelperEvent[] } = {
  commands: [
    { op: "status" },
    { op: "request_permission", openPane: true },
    { op: "codes", codes: [{ id: "c1", code: "530331", service: "KAYAK", senderDomain: "mail.kayak.com", receivedAt: 1_760_000_000_000, expiresAt: 1_760_000_600_000 }] },
    { op: "codes", codes: [] },
    { op: "type_newest" },
    { op: "demo", field: { x: 100, y: 200, width: 240, height: 28 }, code: "482913", service: "Flint" },
    { op: "demo_stop" },
    { op: "shutdown" },
  ],
  events: [
    { event: "ready", protocol: HELPER_PROTOCOL_VERSION, version: "0.1.0", pid: 4242, trusted: false },
    { event: "permission", trusted: true },
    { event: "used", codeId: "c1", via: "suggestion", method: "typed" },
    { event: "fill_failed", codeId: "c1", reason: "secure_input" },
    { event: "observing", active: true },
    { event: "error", message: "AX observer failed for pid 123" },
  ],
};

// ---------- manager contract (implemented in apps/desktop/src/main/autofill) ----------

/**
 * What the core service needs from the desktop app. Injected through ServiceOptions.autofill; absent in tests and the
 * web preview, where the API reports UNSUPPORTED_AUTOFILL_STATUS.
 */
export type AutofillHost = {
  status(): AutofillStatus;
  /** Prompts for Accessibility and opens the pane. Resolves with the status right after (usually still "needs_permission": the user toggles it in System Settings). */
  requestPermission(): Promise<AutofillStatus>;
  tryDemo(): Promise<void>;
};

export const UNSUPPORTED_AUTOFILL_STATUS: AutofillStatus = {
  state: "unavailable", supported: false, permission: "unknown", helperRunning: false, waiting: 0, shortcutActive: null,
};

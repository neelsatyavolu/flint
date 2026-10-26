import { useEffect, useRef } from "react";
import { parseCombo, shortcuts } from "../lib/shortcuts";
import { readStored, writeStored } from "../lib/storage";
import { listStore } from "../state/listStore";
import { navStore } from "../state/nav";
import type { AppCommands } from "./useAppCommands";

/** Whether a key press should be left to a menu or dialog that is open. */
function surfaceOpen(): boolean {
  return navStore.getState().overlay !== null || document.querySelector('[role="menu"]') !== null;
}

/**
 * While a new view loads, the previous rows stay on screen dimmed. Keys that pick rows from the list (j/k, Enter, x,
 * or an action on selected or highlighted rows) wait for the fresh rows; an action on the open thread is still safe.
 */
export function rowsReady(): boolean {
  return !listStore.getState().stale;
}
export function actionTargetReady(): boolean {
  const n = navStore.getState();
  return rowsReady() || (n.openId !== null && n.selected.length === 0);
}

/** True when no button, link or field has focus, so Enter is free to open the highlighted row. */
function idleFocus(): boolean {
  const el = document.activeElement;
  if (!el || el === document.body) return true;
  return !el.closest('button, a, input, textarea, select, summary, [role="menuitem"], [role="separator"], [role="radio"], [role="tab"]');
}

/** What Escape closes, innermost first. Returns false when there is nothing to close. */
export function escapeStep(): boolean {
  const n = navStore.getState();
  if (n.overlay !== null) return false;
  if (n.selected.length) n.clearSelected();
  else if (n.openId !== null) n.openThread(null);
  else if (n.searchOpen) n.closeSearch();
  else if (n.category) n.closeCategory();
  else if (n.settingsOpen) n.closeSettings();
  else return false;
  return true;
}

const SINGLE_KEY_KEY = "flint.singleKeyShortcuts";

/** Settings, Shortcuts, Single-key shortcuts (WCAG 2.1.4). On unless turned off on this device. */
export function singleKeyShortcutsOn(): boolean {
  return readStored(SINGLE_KEY_KEY) !== "0";
}
export function setSingleKeyShortcuts(on: boolean): void {
  writeStored(SINGLE_KEY_KEY, on ? "1" : "0");
}

/** Keys that are not characters, so they stay on when single-key shortcuts are off. */
const NON_CHARACTER_KEYS = new Set(["Escape", "Enter", "ArrowUp", "ArrowDown", "F6"]);

/** Whether a combo starts with a key pressed on its own (e, #, Backspace, the g of "g i"), which the toggle turns off. */
export function isSingleKeyCombo(combo: string): boolean {
  const first = parseCombo(combo)[0] ?? "";
  if (/^(mod|ctrl|alt)\+/.test(first)) return false;
  const key = first.replace(/^shift\+/, "");
  return !NON_CHARACTER_KEYS.has(key);
}

const PANE_SELECTORS = ['nav[aria-label="Mailboxes"]', '[role="listbox"][aria-label="Conversations"]', 'section[aria-label="Conversation"]'];

/** F6 order: sidebar, list, reader. Views without a list or reader (Home, Settings) cycle between the sidebar and main. */
function panes(): HTMLElement[] {
  const found = PANE_SELECTORS.map((sel) => document.querySelector<HTMLElement>(sel));
  const [sidebar, list, reader] = found;
  const main = list || reader ? [list, reader] : [document.querySelector<HTMLElement>("main")];
  return [sidebar, ...main].filter((el): el is HTMLElement => el !== null);
}

/** Index of the pane to focus next, given the pane that holds focus (-1 for none). */
export function nextPaneIndex(current: number, count: number, backwards: boolean): number {
  if (count === 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? count - 1 : 1)) % count;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Moves focus to the next pane: its current item (active nav row, the listbox) or its first control. */
export function cyclePanes(backwards: boolean): void {
  const list = panes();
  const active = document.activeElement;
  const current = list.findIndex((p) => active !== null && p.contains(active));
  const target = list[nextPaneIndex(current, list.length, backwards)];
  if (!target) return;
  const into = target.tabIndex >= 0 ? target : target.querySelector<HTMLElement>('[aria-current="page"]') ?? target.querySelector<HTMLElement>(FOCUSABLE);
  into?.focus();
}

/** Registers the SPEC section 11 keyboard model. Handlers read the latest commands through a ref. */
export function useGlobalShortcuts(cmds: AppCommands): void {
  const ref = useRef(cmds);
  ref.current = cmds;

  useEffect(() => {
    const c = () => ref.current;
    const mail = () => !surfaceOpen() && c().inMailView();
    const act = () => mail() && actionTargetReady();
    const rows = () => mail() && rowsReady();
    const any = () => !surfaceOpen();
    const nav = () => navStore.getState();
    // Each combo is registered on its own so the single-key toggle can turn off "e" but keep "ArrowDown".
    const reg = (combo: string | string[], handler: () => void | false, when: () => boolean, extra: { allowInInput?: boolean } = {}) => {
      const offs = (Array.isArray(combo) ? combo : [combo]).map((one) => {
        const gated = isSingleKeyCombo(one);
        return shortcuts.register(one, () => handler(), { when: () => (!gated || singleKeyShortcutsOn()) && when(), ...extra });
      });
      return () => offs.forEach((off) => off());
    };

    const offs = [
      reg("c", () => c().compose(), any),
      reg("r", () => c().reply("reply"), mail),
      reg("a", () => c().reply("replyAll"), mail),
      reg("f", () => c().reply("forward"), mail),
      reg("e", () => c().archive(), act),
      reg(["#", "Backspace", "Delete"], () => c().trash(), act),
      reg("s", () => c().togglePin(), act),
      reg("h", () => c().snooze(), act),
      reg("v", () => c().move(), act),
      reg("u", () => c().toggleRead(), act),
      reg("!", () => c().spam(), act),
      reg("m", () => c().toggleMute(), act),
      reg("x", () => c().toggleSelect(), rows),
      reg(["j", "ArrowDown"], () => c().step(1), rows),
      reg(["k", "ArrowUp"], () => c().step(-1), rows),
      reg(["Enter", "o"], () => c().openCursor(), () => rows() && idleFocus()),
      reg("Escape", () => (escapeStep() ? undefined : false), () => true),
      reg(["/", "mod+f"], () => nav().openSearch(), () => !surfaceOpen() && !nav().settingsOpen, { allowInInput: false }),
      reg("mod+k", () => nav().showOverlay("palette"), () => nav().overlay === null, { allowInInput: true }),
      reg(["mod+z", "mod+shift+z"], () => void c().undo(), any),
      reg("g i", () => nav().go({ view: "inbox" }), any),
      reg("g s", () => nav().go({ view: "sent" }), any),
      reg("g d", () => nav().go({ view: "drafts" }), any),
      reg("g p", () => nav().go({ view: "pinned" }), any),
      reg("g h", () => nav().go({ view: "home" }), any),
      reg("mod+,", () => nav().openSettings(), () => true, { allowInInput: true }),
      reg("mod+\\", () => c().toggleSidebar(), () => true, { allowInInput: true }),
      reg("?", () => nav().showOverlay("shortcuts"), any),
      reg("F6", () => cyclePanes(false), any, { allowInInput: true }),
      reg("shift+F6", () => cyclePanes(true), any, { allowInInput: true }),
      ...Array.from({ length: 9 }, (_, i) => reg(`mod+${i + 1}`, () => c().goAccount(i), any, { allowInInput: true })),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}

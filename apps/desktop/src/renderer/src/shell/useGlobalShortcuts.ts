import { useEffect, useRef } from "react";
import { shortcuts } from "../lib/shortcuts";
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
    const reg = (combo: string | string[], handler: () => void | false, when: () => boolean, extra: { allowInInput?: boolean } = {}) =>
      shortcuts.register(combo, () => handler(), { when, ...extra });

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
      reg("mod+shift+z", () => void c().undo(), any),
      reg("g i", () => nav().go({ view: "inbox" }), any),
      reg("g s", () => nav().go({ view: "sent" }), any),
      reg("g d", () => nav().go({ view: "drafts" }), any),
      reg("g p", () => nav().go({ view: "pinned" }), any),
      reg("g h", () => nav().go({ view: "home" }), any),
      reg("mod+,", () => nav().openSettings(), () => true, { allowInInput: true }),
      reg("mod+\\", () => c().toggleSidebar(), () => true, { allowInInput: true }),
      reg("?", () => nav().showOverlay("shortcuts"), any),
      ...Array.from({ length: 9 }, (_, i) => reg(`mod+${i + 1}`, () => c().goAccount(i), any, { allowInInput: true })),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}

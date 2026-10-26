import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { shortcuts } from "../lib/shortcuts";
import { navStore } from "../state/nav";
import { cyclePanes, isSingleKeyCombo, nextPaneIndex, setSingleKeyShortcuts, singleKeyShortcutsOn, useGlobalShortcuts } from "./useGlobalShortcuts";
import { handleHostAction, PRINT_EVENT } from "./useHostBridge";
import { triageAction } from "./useAppCommands";
import type { AppCommands } from "./useAppCommands";

function setup() {
  const archive = vi.fn();
  const undo = vi.fn();
  const step = vi.fn();
  const known: Record<string, unknown> = { archive, undo, step, inMailView: () => true, hasTarget: () => true };
  const cmds = new Proxy(known, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : vi.fn()) }) as unknown as AppCommands;
  renderHook(() => useGlobalShortcuts(cmds));
  return { archive, undo, step };
}

function press(key: string, init: KeyboardEventInit = {}) {
  return shortcuts.dispatch(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  navStore.setState({ view: "inbox", search: "", searchOpen: false });
});

describe("single-key shortcuts toggle", () => {
  it("is on unless turned off on this device", () => {
    expect(singleKeyShortcutsOn()).toBe(true);
    setSingleKeyShortcuts(false);
    expect(window.localStorage.getItem("flint.singleKeyShortcuts")).toBe("0");
    expect(singleKeyShortcutsOn()).toBe(false);
    setSingleKeyShortcuts(true);
    expect(singleKeyShortcutsOn()).toBe(true);
  });

  it("classes character keys as single-key and keeps modifier combos and navigation keys", () => {
    for (const c of ["e", "#", "!", "Backspace", "Delete", "j", "/", "?", "g i", "o"]) expect(isSingleKeyCombo(c), c).toBe(true);
    for (const c of ["mod+z", "mod+shift+z", "mod+k", "mod+1", "Escape", "Enter", "ArrowDown", "ArrowUp", "F6", "shift+F6"]) expect(isSingleKeyCombo(c), c).toBe(false);
  });

  it("skips unmodified keys when off while Cmd+Z and arrows keep working", () => {
    const { archive, undo, step } = setup();
    setSingleKeyShortcuts(false);
    expect(press("e")).toBe(false);
    expect(archive).not.toHaveBeenCalled();
    expect(press("j")).toBe(false);
    expect(press("ArrowDown")).toBe(true);
    expect(step).toHaveBeenCalledWith(1);
    expect(press("z", { ctrlKey: true })).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    setSingleKeyShortcuts(true);
    expect(press("e")).toBe(true);
    expect(archive).toHaveBeenCalledTimes(1);
  });
});

describe("F6 pane cycling", () => {
  it("wraps forwards and backwards and starts at an end with nothing focused", () => {
    expect(nextPaneIndex(0, 3, false)).toBe(1);
    expect(nextPaneIndex(2, 3, false)).toBe(0);
    expect(nextPaneIndex(0, 3, true)).toBe(2);
    expect(nextPaneIndex(-1, 3, false)).toBe(0);
    expect(nextPaneIndex(-1, 3, true)).toBe(2);
    expect(nextPaneIndex(-1, 0, false)).toBe(-1);
  });

  it("moves focus from the sidebar to the list and on to the reader", () => {
    document.body.innerHTML = `
      <nav aria-label="Mailboxes"><button id="home">Home</button><button id="inbox" aria-current="page">Inbox</button></nav>
      <main>
        <div role="listbox" aria-label="Conversations" tabindex="0" id="list"></div>
        <section aria-label="Conversation"><button id="archive">Archive</button></section>
      </main>`;
    document.getElementById("home")!.focus();
    cyclePanes(false);
    expect(document.activeElement?.id).toBe("list");
    cyclePanes(false);
    expect(document.activeElement?.id).toBe("archive");
    cyclePanes(false);
    expect(document.activeElement?.id).toBe("inbox");
    cyclePanes(true);
    expect(document.activeElement?.id).toBe("archive");
  });

  it("uses main when a view has no list or reader", () => {
    document.body.innerHTML = `<nav aria-label="Mailboxes"><button id="home" aria-current="page">Home</button></nav><main><button id="first">Catch me up</button></main>`;
    document.getElementById("home")!.focus();
    cyclePanes(false);
    expect(document.activeElement?.id).toBe("first");
  });
});

describe("view-aware triage keys", () => {
  const nav = (view: string, search = "") => ({ view, search, searchOpen: search !== "" }) as Parameters<typeof triageAction>[1];

  it("archives only where it changes something", () => {
    expect(triageAction("archive", nav("inbox"))).toEqual({ type: "archive" });
    for (const v of ["archive", "trash", "spam", "folder"]) expect(triageAction("archive", nav(v)), v).toBeNull();
    expect(triageAction("archive", nav("trash", "invoice"))).toEqual({ type: "archive" });
  });

  it("does nothing on # in Trash and toggles Not spam in Spam", () => {
    expect(triageAction("trash", nav("trash"))).toBeNull();
    expect(triageAction("trash", nav("inbox"))).toEqual({ type: "trash" });
    expect(triageAction("spam", nav("spam"))).toEqual({ type: "spam", spam: false });
    expect(triageAction("spam", nav("inbox"))).toEqual({ type: "spam", spam: true });
  });
});

describe("host menu actions", () => {
  it("undoes typing inside a field and the last mail action elsewhere", () => {
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    const undo = vi.fn();
    document.body.innerHTML = `<input id="field" /><button id="btn">x</button>`;
    document.getElementById("field")!.focus();
    expect(handleHostAction("undo", { undo })).toBe(true);
    expect(exec).toHaveBeenCalledWith("undo");
    expect(undo).not.toHaveBeenCalled();
    document.getElementById("btn")!.focus();
    handleHostAction("undo", { undo });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("turns Print into the flint:print window event and leaves other actions alone", () => {
    const heard = vi.fn();
    window.addEventListener(PRINT_EVENT, heard);
    expect(PRINT_EVENT).toBe("flint:print");
    expect(handleHostAction("print", { undo: vi.fn() })).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(PRINT_EVENT, heard);
    expect(handleHostAction("archive", { undo: vi.fn() })).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { shortcuts } from "../lib/shortcuts";
import { listStore } from "../state/listStore";
import { navStore } from "../state/nav";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import type { AppCommands } from "./useAppCommands";

function setup() {
  const archive = vi.fn();
  const cmds = new Proxy({ archive, inMailView: () => true, hasTarget: () => true }, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : vi.fn()) }) as unknown as AppCommands;
  renderHook(() => useGlobalShortcuts(cmds));
  return archive;
}

function press(el: Element, k: string) {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  Object.defineProperty(e, "target", { value: el });
  return shortcuts.dispatch(e);
}

afterEach(() => {
  document.body.innerHTML = "";
  listStore.setState({ stale: false });
});

describe("global shortcuts and editable scopes", () => {
  it("archives from the list but never from inside the reply dock, a dialog or an editor", () => {
    const archive = setup();
    document.body.innerHTML = `
      <div role="listbox" aria-label="Conversations"><div id="row"></div></div>
      <div data-inline-reply-mount><div id="dockBtn"></div><div class="ProseMirror" id="pm"><p id="p"></p></div></div>
      <div role="dialog"><button id="dlg"></button></div>`;
    expect(press(document.getElementById("row")!, "e")).toBe(true);
    expect(archive).toHaveBeenCalledTimes(1);
    for (const id of ["dockBtn", "p", "dlg"]) expect(press(document.getElementById(id)!, "e")).toBe(false);
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it("waits for fresh rows before acting on list rows, but still acts on the open thread", () => {
    const archive = setup();
    document.body.innerHTML = `<div role="listbox" aria-label="Conversations"><div id="row"></div></div>`;
    const row = document.getElementById("row")!;
    listStore.setState({ stale: true });
    navStore.setState({ openId: null, selected: [] });
    expect(press(row, "e")).toBe(false);
    expect(press(row, "j")).toBe(false);
    navStore.setState({ openId: 7, selected: [] });
    expect(press(row, "e")).toBe(true);
    expect(archive).toHaveBeenCalledTimes(1);
    navStore.setState({ openId: null });
  });
});

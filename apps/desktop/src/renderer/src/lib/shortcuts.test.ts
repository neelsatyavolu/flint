import { describe, expect, it, vi } from "vitest";
import { createShortcutRegistry, formatCombo, parseCombo } from "./shortcuts";

const key = (k: string, init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });

function setup(isMac = true) {
  let t = 0;
  const reg = createShortcutRegistry({ isMac, now: () => t });
  return { reg, advance: (ms: number) => (t += ms) };
}

describe("parseCombo", () => {
  it("canonicalizes modifiers", () => expect(parseCombo("shift+mod+Z")).toEqual(["mod+shift+z"]));
  it("splits sequences", () => expect(parseCombo("g  i")).toEqual(["g", "i"]));
  it("understands aliases", () => expect(parseCombo("esc")).toEqual(["Escape"]));
  it("supports the plus key", () => expect(parseCombo("mod++")).toEqual(["mod++"]));
});

describe("shortcut registry", () => {
  it("fires single keys and prevents default", () => {
    const { reg } = setup();
    const fn = vi.fn();
    reg.register("e", fn);
    const e = key("e");
    expect(reg.dispatch(e)).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it("does not fire for unregistered keys or with extra modifiers", () => {
    const { reg } = setup();
    const fn = vi.fn();
    reg.register("e", fn);
    expect(reg.dispatch(key("x"))).toBe(false);
    expect(reg.dispatch(key("e", { metaKey: true }))).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("maps mod to Command on mac and Control elsewhere", () => {
    const mac = setup(true).reg;
    const win = setup(false).reg;
    const a = vi.fn();
    const b = vi.fn();
    mac.register("mod+k", a);
    win.register("mod+k", b);
    expect(mac.dispatch(key("k", { ctrlKey: true }))).toBe(false);
    expect(mac.dispatch(key("k", { metaKey: true }))).toBe(true);
    expect(win.dispatch(key("k", { metaKey: true }))).toBe(false);
    expect(win.dispatch(key("k", { ctrlKey: true }))).toBe(true);
  });

  it("matches shifted letters and shifted symbols", () => {
    const { reg } = setup();
    const undo = vi.fn();
    const help = vi.fn();
    reg.register("mod+shift+z", undo);
    reg.register("?", help);
    reg.dispatch(key("Z", { metaKey: true, shiftKey: true }));
    reg.dispatch(key("?", { shiftKey: true }));
    expect(undo).toHaveBeenCalledOnce();
    expect(help).toHaveBeenCalledOnce();
    expect(reg.dispatch(key("z", { metaKey: true }))).toBe(false);
  });

  it("matches named keys", () => {
    const { reg } = setup();
    const esc = vi.fn();
    const send = vi.fn();
    reg.register("Escape", esc);
    reg.register("mod+Enter", send);
    reg.dispatch(key("Escape"));
    reg.dispatch(key("Enter", { metaKey: true }));
    expect(esc).toHaveBeenCalled();
    expect(send).toHaveBeenCalled();
  });

  it("runs sequences", () => {
    const { reg } = setup();
    const inbox = vi.fn();
    const sent = vi.fn();
    reg.register("g i", inbox);
    reg.register("g s", sent);
    expect(reg.dispatch(key("g"))).toBe(true); // waiting for the second key
    expect(inbox).not.toHaveBeenCalled();
    reg.dispatch(key("i"));
    expect(inbox).toHaveBeenCalledOnce();
    reg.dispatch(key("g"));
    reg.dispatch(key("s"));
    expect(sent).toHaveBeenCalledOnce();
  });

  it("drops a pending sequence after the timeout", () => {
    const { reg, advance } = setup();
    const inbox = vi.fn();
    reg.register("g i", inbox);
    reg.dispatch(key("g"));
    advance(1500);
    reg.dispatch(key("i"));
    expect(inbox).not.toHaveBeenCalled();
  });

  it("recovers when a sequence breaks and the key is a binding on its own", () => {
    const { reg } = setup();
    const compose = vi.fn();
    reg.register("g i", vi.fn());
    reg.register("c", compose);
    reg.dispatch(key("g"));
    reg.dispatch(key("c"));
    expect(compose).toHaveBeenCalledOnce();
  });

  it("ignores events from inputs, textareas and contenteditable unless allowed", () => {
    const { reg } = setup();
    reg.attach(document);
    const plain = vi.fn();
    const allowed = vi.fn();
    reg.register("e", plain);
    reg.register("mod+Enter", allowed, { allowInInput: true });
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(input, area, editable);
    for (const el of [input, area, editable]) el.dispatchEvent(key("e"));
    input.dispatchEvent(key("Enter", { metaKey: true }));
    expect(plain).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledOnce();
    document.body.dispatchEvent(key("e"));
    expect(plain).toHaveBeenCalledOnce();
    input.remove(); area.remove(); editable.remove();
  });

  it("lets later registrations win and falls through on false", () => {
    const { reg } = setup();
    const first = vi.fn();
    const second = vi.fn(() => false as const);
    reg.register("e", first);
    reg.register("e", second);
    reg.dispatch(key("e"));
    expect(second).toHaveBeenCalled();
    expect(first).toHaveBeenCalled();
  });

  it("unregisters and honors when()", () => {
    const { reg } = setup();
    const fn = vi.fn();
    let active = false;
    const off = reg.register(["a", "b"], fn, { when: () => active });
    reg.dispatch(key("a"));
    expect(fn).not.toHaveBeenCalled();
    active = true;
    reg.dispatch(key("b"));
    expect(fn).toHaveBeenCalledOnce();
    off();
    reg.dispatch(key("a"));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("ignores bare modifier presses and IME composition", () => {
    const { reg } = setup();
    const fn = vi.fn();
    reg.register("shift+a", fn);
    expect(reg.dispatch(key("Shift", { shiftKey: true }))).toBe(false);
    expect(reg.dispatch(key("A", { shiftKey: true, isComposing: true }))).toBe(false);
  });

  it("skips preventDefault when asked", () => {
    const { reg } = setup();
    reg.register("e", vi.fn(), { preventDefault: false });
    const e = key("e");
    reg.dispatch(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("attach/detach wires keydown on a target", () => {
    const { reg } = setup();
    const fn = vi.fn();
    reg.register("e", fn);
    const off = reg.attach(document);
    document.dispatchEvent(key("e"));
    off();
    document.dispatchEvent(key("e"));
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("formatCombo", () => {
  it("renders mac symbols", () => {
    expect(formatCombo("mod+k", true)).toBe("⌘K");
    expect(formatCombo("mod+shift+z", true)).toBe("⇧⌘Z");
    expect(formatCombo("g i", true)).toBe("G I");
    expect(formatCombo("Escape", true)).toBe("Esc");
  });
  it("renders words elsewhere", () => expect(formatCombo("mod+shift+z", false)).toBe("Ctrl+Shift+Z"));
});

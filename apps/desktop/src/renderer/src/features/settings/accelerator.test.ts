import { describe, expect, it } from "vitest";
import { acceleratorFromEvent, formatAccelerator } from "./accelerator";

const ev = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe("acceleratorFromEvent", () => {
  it("builds an Electron accelerator in a stable modifier order", () => {
    expect(acceleratorFromEvent(ev("KeyV", { altKey: true, ctrlKey: true }))).toBe("Control+Option+V");
    expect(acceleratorFromEvent(ev("Digit7", { metaKey: true, shiftKey: true }))).toBe("Shift+Command+7");
    expect(acceleratorFromEvent(ev("F5", { ctrlKey: true }))).toBe("Control+F5");
    expect(acceleratorFromEvent(ev("Space", { altKey: true }))).toBe("Option+Space");
  });
  it("needs a modifier and a real key", () => {
    expect(acceleratorFromEvent(ev("KeyV"))).toBeNull();
    expect(acceleratorFromEvent(ev("ControlLeft", { ctrlKey: true }))).toBeNull();
    expect(acceleratorFromEvent(ev("Escape", { ctrlKey: true }))).toBeNull();
  });
});

describe("formatAccelerator", () => {
  it("shows Mac symbols", () => {
    expect(formatAccelerator("Control+Option+V")).toBe("⌃⌥V");
    expect(formatAccelerator("Shift+Command+7")).toBe("⇧⌘7");
  });
});

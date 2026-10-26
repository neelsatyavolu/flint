import { describe, expect, it, vi } from "vitest";
import { buildMenuTemplate } from "./menu-template";

type Item = { label?: string; role?: string; accelerator?: string; visible?: boolean; click?: (...a: unknown[]) => void };

describe("menu template: undo, print and zoom", () => {
  const sub = (i: number, send = vi.fn()) => buildMenuTemplate({ isMac: true, isDev: false, send })[i]?.submenu as Item[];

  it("sends Undo to the renderer instead of the native undo role, even from the keystroke", () => {
    const send = vi.fn();
    const edit = sub(2, send);
    expect(edit.some((i) => i.role === "undo")).toBe(false);
    const undo = edit.find((i) => i.label === "Undo")!;
    expect(undo.accelerator).toBe("CmdOrCtrl+Z");
    undo.click?.({}, undefined, { triggeredByAccelerator: true });
    expect(send).toHaveBeenCalledWith("undo");
  });

  it("puts Print in the File menu", () => {
    const send = vi.fn();
    const print = sub(1, send).find((i) => i.label === "Print...")!;
    expect(print.accelerator).toBe("CmdOrCtrl+P");
    print.click?.({}, undefined, {});
    expect(send).toHaveBeenCalledWith("print");
  });

  it("has zoom items, with a hidden Cmd+= twin for zoom in", () => {
    const view = sub(3);
    expect(view.map((i) => i.role)).toEqual(expect.arrayContaining(["resetZoom", "zoomIn", "zoomOut"]));
    expect(view.find((i) => i.role === "zoomIn" && i.visible === false)?.accelerator).toBe("CmdOrCtrl+=");
  });
});

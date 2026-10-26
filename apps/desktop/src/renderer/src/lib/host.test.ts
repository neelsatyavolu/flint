import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTextSize, readTextSize } from "./host";

afterEach(() => {
  window.localStorage.clear();
  delete (window as unknown as { flintHost?: unknown }).flintHost;
});

describe("text size", () => {
  it("defaults to Default and ignores unknown stored values", () => {
    expect(readTextSize()).toBe("default");
    window.localStorage.setItem("flint.textSize", "huge");
    expect(readTextSize()).toBe("default");
  });

  it("sets the window zoom and remembers the choice only when asked", () => {
    const setZoomFactor = vi.fn();
    (window as unknown as { flintHost: unknown }).flintHost = { platform: "darwin", setZoomFactor };
    applyTextSize("large");
    expect(setZoomFactor).toHaveBeenLastCalledWith(1.1);
    expect(readTextSize()).toBe("default");
    applyTextSize("larger", true);
    expect(setZoomFactor).toHaveBeenLastCalledWith(1.25);
    expect(readTextSize()).toBe("larger");
  });

  it("does nothing without a host bridge", () => {
    expect(() => applyTextSize("small", true)).not.toThrow();
    expect(readTextSize()).toBe("small");
  });
});

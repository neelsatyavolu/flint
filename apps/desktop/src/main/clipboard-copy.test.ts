import { describe, expect, it, vi } from "vitest";
import { createClipboardCopier } from "./clipboard-copy";

function setup() {
  let text = "";
  const clipboard = { readText: () => text, writeText: (t: string) => { text = t; } };
  vi.useFakeTimers();
  return { clipboard, copy: createClipboardCopier({ clipboard }), get: () => text, set: (t: string) => { text = t; } };
}

describe("createClipboardCopier", async () => {
  it("copies, then clears after the delay when the clipboard still holds the code", async () => {
    const { copy, get } = setup();
    copy("530331", 90_000);
    expect(get()).toBe("530331");
    await vi.advanceTimersByTimeAsync(89_999);
    expect(get()).toBe("530331");
    await vi.advanceTimersByTimeAsync(1);
    expect(get()).toBe("");
    vi.useRealTimers();
  });

  it("leaves the clipboard alone when the user copied something else", async () => {
    const { copy, get, set } = setup();
    copy("530331", 90_000);
    set("shopping list");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(get()).toBe("shopping list");
    vi.useRealTimers();
  });

  it("a newer copy restarts the clock", async () => {
    const { copy, get } = setup();
    copy("111111", 90_000);
    await vi.advanceTimersByTimeAsync(60_000);
    copy("222222", 90_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(get()).toBe("222222");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(get()).toBe("");
    vi.useRealTimers();
  });
});

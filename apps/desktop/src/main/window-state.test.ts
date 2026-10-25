// @vitest-environment node
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BOUNDS, loadWindowState, saveWindowState, trackWindowState, type TrackableWindow } from "./window-state";

const screen = [{ x: 0, y: 0, width: 1920, height: 1080 }];
let dir: string;
let file: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "flint-win-")); file = join(dir, "window.json"); });
afterEach(async () => { vi.useRealTimers(); await rm(dir, { recursive: true, force: true }); });

describe("window state", () => {
  it("defaults when the file is missing or corrupt", async () => {
    expect(loadWindowState(file, screen)).toEqual(DEFAULT_BOUNDS);
    await writeFile(file, "{nope");
    expect(loadWindowState(file, screen)).toEqual(DEFAULT_BOUNDS);
    await writeFile(file, JSON.stringify({ width: 100, height: 100 }));
    expect(loadWindowState(file, screen)).toEqual(DEFAULT_BOUNDS);
  });

  it("round trips saved bounds", () => {
    saveWindowState(file, { x: 10, y: 20, width: 1200, height: 800, maximized: true });
    expect(loadWindowState(file, screen)).toEqual({ x: 10, y: 20, width: 1200, height: 800, maximized: true });
  });

  it("drops the position when it is off every display", () => {
    saveWindowState(file, { x: 5000, y: 5000, width: 1200, height: 800 });
    expect(loadWindowState(file, screen)).toEqual({ width: 1200, height: 800 });
  });

  it("keeps size-only state", () => {
    saveWindowState(file, { width: 1000, height: 700 });
    expect(loadWindowState(file, screen)).toEqual({ width: 1000, height: 700 });
  });

  it("tracks a window with debounce and flushes on close", async () => {
    vi.useFakeTimers();
    const handlers = new Map<string, () => void>();
    let bounds = { x: 1, y: 2, width: 1300, height: 850 };
    const win: TrackableWindow = {
      getNormalBounds: () => bounds,
      isMaximized: () => false,
      isDestroyed: () => false,
      on: (ev, cb) => { handlers.set(ev, cb); },
    };
    trackWindowState(win, file, 400);
    handlers.get("resize")?.();
    handlers.get("move")?.();
    vi.advanceTimersByTime(399);
    await expect(readFile(file)).rejects.toThrow();
    vi.advanceTimersByTime(2);
    expect(loadWindowState(file, screen)).toMatchObject({ x: 1, y: 2, width: 1300, height: 850, maximized: false });
    bounds = { x: 3, y: 4, width: 500, height: 400 };
    handlers.get("close")?.();
    expect(loadWindowState(file, screen)).toMatchObject({ x: 3, y: 4, width: 960, height: 600 });
  });

  it("does not save a destroyed window", () => {
    const handlers = new Map<string, () => void>();
    const win: TrackableWindow = {
      getNormalBounds: () => { throw new Error("destroyed"); },
      isMaximized: () => false,
      isDestroyed: () => true,
      on: (ev, cb) => { handlers.set(ev, cb); },
    };
    trackWindowState(win, file);
    expect(() => handlers.get("close")?.()).not.toThrow();
  });
});

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export const MIN_WIDTH = 960;
export const MIN_HEIGHT = 600;
export const DEFAULT_BOUNDS = { width: 1400, height: 900 } as const;

const stateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(MIN_WIDTH),
  height: z.number().int().min(MIN_HEIGHT),
  maximized: z.boolean().optional(),
});

export type WindowState = z.infer<typeof stateSchema>;
export type Rect = { x: number; y: number; width: number; height: number };

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Reads saved window state. Falls back to defaults on a missing or corrupt
 * file, and drops the position when it no longer lands on any display.
 */
export function loadWindowState(file: string, workAreas: readonly Rect[]): WindowState {
  let parsed: WindowState | null = null;
  try {
    const result = stateSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    parsed = result.success ? result.data : null;
  } catch {
    parsed = null;
  }
  if (!parsed) return { ...DEFAULT_BOUNDS };
  if (parsed.x === undefined || parsed.y === undefined) return parsed;
  const rect: Rect = { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height };
  if (workAreas.some((area) => intersects(rect, area))) return parsed;
  const { x: _x, y: _y, ...rest } = parsed;
  return rest;
}

export function saveWindowState(file: string, state: WindowState): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), "utf8");
  renameSync(tmp, file);
}

export type TrackableWindow = {
  getNormalBounds(): Rect;
  isMaximized(): boolean;
  isDestroyed(): boolean;
  on(event: "resize" | "move" | "close" | "maximize" | "unmaximize", cb: () => void): unknown;
};

/** Persists bounds on resize, move and close (debounced; close flushes). */
export function trackWindowState(win: TrackableWindow, file: string, debounceMs = 400): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds();
    saveWindowState(file, {
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.max(MIN_WIDTH, Math.round(b.width)),
      height: Math.max(MIN_HEIGHT, Math.round(b.height)),
      maximized: win.isMaximized(),
    });
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, debounceMs);
  };
  for (const ev of ["resize", "move", "maximize", "unmaximize"] as const) win.on(ev, schedule);
  win.on("close", save);
}

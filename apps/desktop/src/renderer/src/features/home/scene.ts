import { format, getDayOfYear } from "date-fns";
import { readStored, writeStored } from "../../lib/storage";

export type SceneSlot = "dawn" | "day" | "dusk" | "night";
export type SceneTone = "light" | "dark";

export type Scene = {
  id: string;
  slot: SceneSlot;
  /** File name in assets/scenes. */
  file: string;
  /** Bundled asset URL (Vite fingerprints it; served from the app origin). */
  url: string;
  /** CSS object-position: the part of the photo to keep when the pane crops it. */
  focal: string;
  /**
   * Scrim alpha this photo needs so --on-scene text in the band stays readable (measured on its top band).
   * The theme's --scene-scrim is the floor; the stronger of the two applies.
   */
  scrim: number;
  /** Overall brightness. Paper prefers light scenes when the slot has one. */
  tone: SceneTone;
  credit: string;
  place: string;
  sourceUrl: string;
  license: "Public domain" | "CC0 1.0";
};

/** Local hour to slot: dawn 5-9, day 9-17, dusk 17-20, night 20-5. */
export function slotFor(hour: number): SceneSlot {
  if (hour >= 5 && hour < 9) return "dawn";
  if (hour >= 9 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

/**
 * The calendar day a scene belongs to. Hours before 5 AM still count as the previous evening, so the night photo
 * does not change at midnight. Calendar arithmetic (not ms) keeps DST days intact.
 */
export function sceneDay(now: number): Date {
  const d = new Date(now);
  return d.getHours() < 5 ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1) : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The photo for this moment: the slot's scenes rotate by day of year, shifted by `offset` ("Next photo").
 * With `prefer`, scenes of that tone win when the slot has any. Null when no scene fits.
 */
export function pickScene(now: number, scenes: readonly Scene[], offset = 0, prefer?: SceneTone): Scene | null {
  const slot = slotFor(new Date(now).getHours());
  const inSlot = scenes.filter((s) => s.slot === slot);
  const preferred = prefer ? inSlot.filter((s) => s.tone === prefer) : [];
  const pool = preferred.length ? preferred : inSlot;
  if (!pool.length) return null;
  const n = pool.length;
  const i = (((getDayOfYear(sceneDay(now)) + offset) % n) + n) % n;
  return pool[i] ?? null;
}

// ---------- Per-device preferences ----------

export type SceneMode = "photo" | "plain";

export const SCENE_MODE_KEY = "flint.homeScene";
export const SCENE_OFFSET_KEY = "flint.homeSceneOffset";

export function readSceneMode(): SceneMode {
  return readStored(SCENE_MODE_KEY) === "plain" ? "plain" : "photo";
}

export function writeSceneMode(mode: SceneMode): void {
  writeStored(SCENE_MODE_KEY, mode);
}

function dayKey(now: number): string {
  return format(sceneDay(now), "yyyy-MM-dd");
}

/** "Next photo" lasts for the scene day: a stored offset from another day reads as 0. */
export function parseSceneOffset(raw: string | null, now: number): number {
  if (!raw) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return 0;
    const { day, offset } = parsed as { day?: unknown; offset?: unknown };
    return day === dayKey(now) && typeof offset === "number" && Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

export function serializeSceneOffset(offset: number, now: number): string {
  return JSON.stringify({ day: dayKey(now), offset });
}

export function readSceneOffset(now: number): number {
  return parseSceneOffset(readStored(SCENE_OFFSET_KEY), now);
}

/** Moves to the next photo for the rest of the day and returns the new offset. */
export function bumpSceneOffset(now: number): number {
  const next = readSceneOffset(now) + 1;
  writeStored(SCENE_OFFSET_KEY, serializeSceneOffset(next, now));
  return next;
}

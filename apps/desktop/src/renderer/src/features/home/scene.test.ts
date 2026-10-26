import { afterEach, describe, expect, it } from "vitest";
import {
  SCENE_MODE_KEY, SCENE_OFFSET_KEY, bumpSceneOffset, parseSceneOffset, pickScene, readSceneMode, readSceneOffset, sceneDay,
  serializeSceneOffset, slotFor, writeSceneMode, type Scene,
} from "./scene";

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

function scene(id: string, slot: Scene["slot"], tone: Scene["tone"] = "dark"): Scene {
  return { id, slot, tone, file: `${id}.avif`, url: `/${id}.avif`, focal: "50% 50%", scrim: 0, credit: "NPS", place: "Somewhere", sourceUrl: "https://commons.wikimedia.org/", license: "Public domain" };
}

const SCENES = [
  scene("dawn-a", "dawn"), scene("dawn-b", "dawn"), scene("dawn-c", "dawn"),
  scene("day-a", "day", "light"), scene("day-b", "day"), scene("day-c", "day", "light"),
  scene("dusk-a", "dusk"), scene("dusk-b", "dusk"), scene("dusk-c", "dusk"),
  scene("night-a", "night"), scene("night-b", "night"), scene("night-c", "night"),
];

describe("slotFor", () => {
  it.each([
    [4, "night"], [5, "dawn"], [8, "dawn"], [9, "day"], [16, "day"], [17, "dusk"], [19, "dusk"], [20, "night"], [23, "night"], [0, "night"],
  ] as const)("hour %i is %s", (hour, slot) => expect(slotFor(hour)).toBe(slot));
});

describe("pickScene", () => {
  it("switches from night to dawn between 4:59 and 5:00", () => {
    expect(pickScene(at(2026, 10, 25, 4, 59), SCENES)!.slot).toBe("night");
    expect(pickScene(at(2026, 10, 25, 5, 0), SCENES)!.slot).toBe("dawn");
  });

  it("keeps the same night photo across midnight", () => {
    const evening = pickScene(at(2026, 10, 25, 23, 59), SCENES);
    expect(pickScene(at(2026, 10, 26, 0, 0), SCENES)).toBe(evening);
    expect(pickScene(at(2026, 10, 26, 4, 30), SCENES)).toBe(evening);
  });

  it("rotates through the slot day by day", () => {
    const ids = [25, 26, 27].map((d) => pickScene(at(2026, 10, d, 12), SCENES)!.id);
    expect(new Set(ids).size).toBe(3);
    expect(pickScene(at(2026, 10, 28, 12), SCENES)!.id).toBe(ids[0]);
  });

  it("holds one photo through a DST change day", () => {
    // Mar 8 and Nov 1 2026 are the US DST switches; calendar days keep the pick stable however long the day is.
    for (const [m, d] of [[3, 8], [11, 1]] as const) {
      expect(pickScene(at(2026, m, d, 1, 30), SCENES)!.slot).toBe("night");
      expect(pickScene(at(2026, m, d, 5, 0), SCENES)!.slot).toBe("dawn");
      expect(pickScene(at(2026, m, d, 9, 0), SCENES)).toBe(pickScene(at(2026, m, d, 16, 59), SCENES));
    }
  });

  it("moves to the next photo with the offset", () => {
    const base = pickScene(at(2026, 10, 25, 12), SCENES)!;
    const next = pickScene(at(2026, 10, 25, 12), SCENES, 1)!;
    expect(next.slot).toBe("day");
    expect(next.id).not.toBe(base.id);
    expect(pickScene(at(2026, 10, 25, 12), SCENES, 3)).toBe(base);
  });

  it("prefers the requested tone when the slot has one", () => {
    for (let off = 0; off < 4; off++) expect(pickScene(at(2026, 10, 25, 12), SCENES, off, "light")!.tone).toBe("light");
    expect(pickScene(at(2026, 10, 25, 22), SCENES, 0, "light")!.slot).toBe("night");
  });

  it("returns null without scenes for the slot", () => {
    expect(pickScene(at(2026, 10, 25, 12), SCENES.filter((s) => s.slot !== "day"))).toBeNull();
  });
});

describe("sceneDay", () => {
  it("counts the small hours as the previous day", () => {
    expect(sceneDay(at(2026, 1, 1, 2)).getFullYear()).toBe(2025);
    expect(sceneDay(at(2026, 1, 1, 5)).getDate()).toBe(1);
  });
});

describe("scene preferences", () => {
  afterEach(() => localStorage.clear());

  it("reads the offset only on the day it was stored", () => {
    const raw = serializeSceneOffset(2, at(2026, 10, 25, 12));
    expect(parseSceneOffset(raw, at(2026, 10, 25, 22))).toBe(2);
    expect(parseSceneOffset(raw, at(2026, 10, 26, 3))).toBe(2);
    expect(parseSceneOffset(raw, at(2026, 10, 26, 6))).toBe(0);
  });

  it("ignores unreadable offsets", () => {
    for (const raw of [null, "", "nope", "[]", "{\"day\":1}", "{\"day\":\"2026-10-25\",\"offset\":-1}"]) expect(parseSceneOffset(raw, at(2026, 10, 25))).toBe(0);
  });

  it("bumps and stores the offset", () => {
    const now = at(2026, 10, 25, 12);
    expect(bumpSceneOffset(now)).toBe(1);
    expect(bumpSceneOffset(now)).toBe(2);
    expect(readSceneOffset(now)).toBe(2);
    expect(localStorage.getItem(SCENE_OFFSET_KEY)).toContain("2026-10-25");
  });

  it("defaults to the photo background", () => {
    expect(readSceneMode()).toBe("photo");
    writeSceneMode("plain");
    expect(localStorage.getItem(SCENE_MODE_KEY)).toBe("plain");
    expect(readSceneMode()).toBe("plain");
  });
});

import { describe, expect, it } from "vitest";
import { formatPresetTime, parseLocalInput, resolvePresets, toLocalInput } from "./time";

const d = (y: number, m: number, day: number, h: number, min = 0) => new Date(y, m - 1, day, h, min);
const find = (list: ReturnType<typeof resolvePresets>, id: string) => list.find((p) => p.id === id);

describe("resolvePresets", () => {
  it("resolves all four on a weekday morning (Monday 10:10)", () => {
    const list = resolvePresets(d(2026, 10, 26, 10, 10));
    expect(list.map((p) => p.id)).toEqual(["later", "tomorrow", "weekend", "nextWeek"]);
    expect(new Date(find(list, "later")!.at)).toEqual(d(2026, 10, 26, 13, 30));
    expect(new Date(find(list, "tomorrow")!.at)).toEqual(d(2026, 10, 27, 8));
    expect(new Date(find(list, "weekend")!.at)).toEqual(d(2026, 10, 31, 9));
    expect(new Date(find(list, "nextWeek")!.at)).toEqual(d(2026, 11, 2, 8));
  });

  it("rounds later-today to the half hour boundary", () => {
    expect(new Date(find(resolvePresets(d(2026, 10, 26, 9, 0)), "later")!.at)).toEqual(d(2026, 10, 26, 12, 0));
    expect(new Date(find(resolvePresets(d(2026, 10, 26, 9, 45)), "later")!.at)).toEqual(d(2026, 10, 26, 13, 0));
  });

  it("drops later-today in the evening", () => {
    expect(find(resolvePresets(d(2026, 10, 26, 20, 0)), "later")).toBeUndefined();
    expect(find(resolvePresets(d(2026, 10, 26, 19, 0)), "later")).toBeUndefined(); // 22:00 is the cutoff
  });

  it("drops this-weekend on Saturday and Sunday and points next week at Monday", () => {
    const sat = resolvePresets(d(2026, 10, 24, 10));
    expect(find(sat, "weekend")).toBeUndefined();
    expect(new Date(find(sat, "nextWeek")!.at)).toEqual(d(2026, 10, 26, 8));
    const sun = resolvePresets(d(2026, 10, 25, 10));
    expect(find(sun, "weekend")).toBeUndefined();
    expect(new Date(find(sun, "nextWeek")!.at)).toEqual(d(2026, 10, 26, 8));
  });

  it("accepts a timestamp and keeps every preset in the future", () => {
    const now = d(2026, 10, 30, 23, 30).getTime();
    for (const p of resolvePresets(now)) expect(p.at).toBeGreaterThan(now);
  });
});

describe("formatPresetTime", () => {
  const now = d(2026, 10, 26, 10);
  it("shows just the time today", () => expect(formatPresetTime(d(2026, 10, 26, 18).getTime(), now)).toBe("6:00 PM"));
  it("shows weekday and time within a week", () => expect(formatPresetTime(d(2026, 10, 27, 8).getTime(), now)).toBe("Tue 8:00 AM"));
  it("shows the date beyond a week", () => expect(formatPresetTime(d(2026, 11, 9, 8).getTime(), now)).toBe("Nov 9, 8:00 AM"));
});

describe("local input helpers", () => {
  it("round-trips datetime-local values", () => {
    const t = d(2026, 11, 3, 14, 5).getTime();
    expect(toLocalInput(t)).toBe("2026-11-03T14:05");
    expect(parseLocalInput("2026-11-03T14:05")).toBe(t);
  });
  it("rejects empty and invalid input", () => {
    expect(parseLocalInput("")).toBeNull();
    expect(parseLocalInput("nope")).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { bump, loadUsage, MAX_BOOST, recentIds, recordUse, usageBoost, type Usage } from "./usage";

const DAY = 86_400_000;
beforeEach(() => localStorage.clear());

describe("usage", () => {
  it("boosts what is used often and what was used lately, within the cap", () => {
    const now = 100 * DAY;
    let u = {};
    u = bump(u, "a", now);
    const once = usageBoost(u, "a", now);
    for (let i = 0; i < 30; i++) u = bump(u, "b", now);
    expect(usageBoost(u, "b", now)).toBeGreaterThan(once);
    expect(usageBoost(u, "b", now)).toBeLessThanOrEqual(MAX_BOOST);
    expect(usageBoost(u, "a", now + 30 * DAY)).toBeLessThan(once / 2);
    expect(usageBoost(u, "never", now)).toBe(0);
  });

  it("does not change the map it is given", () => {
    const before = { a: { n: 1, last: 5 } };
    bump(before, "a", 9);
    expect(before).toEqual({ a: { n: 1, last: 5 } });
  });

  it("lists the most recent first and keeps a bounded history", () => {
    let u: Usage = {};
    u = bump(u, "old", 1);
    u = bump(u, "new", 3);
    u = bump(u, "mid", 2);
    expect(recentIds(u, 2)).toEqual(["new", "mid"]);
    for (let i = 0; i < 200; i++) u = bump(u, `x${i}`, 10 + i);
    expect(Object.keys(u).length).toBeLessThanOrEqual(120);
    expect(u["x199"]).toBeDefined();
  });

  it("persists across loads and ignores bad data", () => {
    recordUse({}, "archive", 42);
    expect(loadUsage()).toEqual({ archive: { n: 1, last: 42 } });
    localStorage.setItem("flint.palette.usage", "not json");
    expect(loadUsage()).toEqual({});
    localStorage.setItem("flint.palette.usage", JSON.stringify({ a: { n: "x" }, b: { n: 2, last: 3 } }));
    expect(loadUsage()).toEqual({ b: { n: 2, last: 3 } });
  });
});

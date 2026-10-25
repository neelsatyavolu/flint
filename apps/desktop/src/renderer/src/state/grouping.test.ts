import { describe, expect, it } from "vitest";
import { buildEntries, groupByDate, rangeIds, stepKey, threadIdOf, threadKey } from "./grouping";
import { bundle, item } from "./testFixtures";

const NOW = Date.UTC(2026, 9, 25, 15);

describe("grouping", () => {
  it("places a bundle where its latest mail falls", () => {
    const items = [item(1), item(2), item(3)];
    const b = bundle("newsletters", items[1]!.lastDate - 1);
    const keys = buildEntries(items, [b]).map((e) => e.key);
    expect(keys).toEqual(["t1", "t2", "b:newsletters", "t3"]);
  });

  it("appends a bundle older than everything", () => {
    const keys = buildEntries([item(1)], [bundle("notifications", 0)]).map((e) => e.key);
    expect(keys).toEqual(["t1", "b:notifications"]);
  });

  it("orders bundles for oldest-first lists", () => {
    const items = [item(3), item(2), item(1)];
    const keys = buildEntries(items, [bundle("notifications", items[1]!.lastDate + 1)], "oldest").map((e) => e.key);
    expect(keys).toEqual(["t3", "t2", "b:notifications", "t1"]);
  });

  it("inserts a label before each date group", () => {
    const rows = groupByDate(buildEntries([item(1), item(2, { lastDate: NOW - 3 * 86_400_000 })], []), NOW);
    expect(rows.map((r) => r.kind)).toEqual(["label", "thread", "label", "thread"]);
  });

  it("maps keys to ids", () => {
    expect(threadIdOf(threadKey(7))).toBe(7);
    expect(threadIdOf("b:newsletters")).toBeNull();
    expect(threadIdOf(null)).toBeNull();
  });

  it("selects an inclusive range and skips bundles", () => {
    const entries = buildEntries([item(1), item(2), item(3), item(4)], [bundle("newsletters", item(2).lastDate - 1)]);
    expect(rangeIds(entries, "t1", "t3")).toEqual([1, 2, 3]);
    expect(rangeIds(entries, "t3", "t1")).toEqual([1, 2, 3]);
    expect(rangeIds(entries, null, "t2")).toEqual([2]);
    expect(rangeIds(entries, "t1", "t99")).toEqual([]);
  });

  it("steps through rows and clamps at the ends", () => {
    const entries = buildEntries([item(1), item(2)], [bundle("newsletters", 0)]);
    expect(stepKey(entries, null, 1)).toBe("t1");
    expect(stepKey(entries, null, -1)).toBe("b:newsletters");
    expect(stepKey(entries, "t1", 1)).toBe("t2");
    expect(stepKey(entries, "t2", 1)).toBe("b:newsletters");
    expect(stepKey(entries, "b:newsletters", 1)).toBe("b:newsletters");
    expect(stepKey(entries, "t1", -1)).toBe("t1");
    expect(stepKey(entries, "t2", 1, false)).toBe("t2");
    expect(stepKey([], null, 1)).toBeNull();
  });
});

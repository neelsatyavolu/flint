import { describe, expect, it } from "vitest";
import { matchToken, rank } from "./fuzzy";
import { filterItems } from "./filter";

const score = (q: string, label: string) => rank(q, label)?.score ?? -Infinity;

describe("rank", () => {
  it("orders prefix, word start, acronym, substring and scattered matches", () => {
    const tiers = [score("arc", "Archive"), score("arc", "Open archive"), score("mtf", "Move to folder"), score("arc", "Search"), score("arc", "Marketing cache")];
    expect(tiers[0]).toBeGreaterThan(tiers[1]!);
    expect(tiers[1]).toBeGreaterThan(tiers[3]!);
    expect(tiers[3]).toBeGreaterThan(tiers[4]!);
    expect(tiers[2]).toBeGreaterThan(tiers[3]!);
    expect(tiers[4]).toBeGreaterThan(-Infinity);
  });

  it("matches acronyms across words, skipping small words", () => {
    expect(rank("gi", "Go to Inbox")?.ranges).toEqual([[0, 1], [6, 7]]);
    expect(rank("mtf", "Move to folder")).not.toBeNull();
    expect(rank("tm", "Move to Trash")).toBeNull();
  });

  it("only scatters letters for words of three or more letters", () => {
    expect(rank("inbx", "Inbox")).not.toBeNull();
    expect(rank("ix", "Inbox")).toBeNull();
    expect(rank("zzz", "Inbox")).toBeNull();
  });

  it("needs every word, in the label or the keywords", () => {
    expect(rank("move fol", "Move to folder")).not.toBeNull();
    expect(rank("move fol", "Move to Trash")).toBeNull();
    expect(rank("done", "Archive", "done")).not.toBeNull();
    expect(rank("delete", "Move to Trash", "delete remove")!.ranges).toEqual([]);
  });

  it("prefers a label match to a keyword match", () => {
    expect(rank("sync", "Sync now", "refresh")!.score).toBeGreaterThan(rank("sync", "Refresh", "sync")!.score);
  });

  it("returns the matched characters for highlighting, merged", () => {
    expect(rank("arc", "Archive")!.ranges).toEqual([[0, 3]]);
    expect(rank("mov fol", "Move to folder")!.ranges).toEqual([[0, 3], [8, 11]]);
    expect(matchToken("ive", "Archive")!.ranges).toEqual([[4, 7]]);
  });

  it("breaks ties toward the shorter label", () => {
    expect(score("mark", "Mark as spam")).toBeGreaterThan(score("mark", "Mark read or unread"));
  });

  it("accepts an empty query", () => {
    expect(rank("  ", "Anything")).toEqual({ score: 0, ranges: [] });
  });
});

describe("filterItems (small pickers)", () => {
  const items = [{ id: "1", label: "Travel" }, { id: "2", label: "Team" }, { id: "3", label: "Receipts", keywords: "invoices" }];
  it("keeps the order when nothing is typed", () => {
    expect(filterItems(items, " ")).toEqual(items);
  });
  it("ranks and filters by fuzzy match, including keywords", () => {
    expect(filterItems(items, "tea").map((i) => i.id)).toEqual(["2"]);
    expect(filterItems(items, "inv").map((i) => i.id)).toEqual(["3"]);
    expect(filterItems(items, "tvl").map((i) => i.id)).toEqual(["1"]);
  });
});

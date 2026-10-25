import { describe, expect, it, vi } from "vitest";
import { dateFilters, stripDateFilters, buildAskContext, citedThreads, extractQueries, retrieve, type Hit } from "./ask";
import { makeContext } from "./testing";

const from = { name: "Ana", address: "ana@x.com" };
const hit = (threadId: number, subject = `S${threadId}`): Hit => ({ threadId, subject, date: Date.UTC(2024, 4, 3), from, snippet: `snip${threadId}` });

describe("extractQueries", () => {
  it("drops stopwords and joins keywords", () => {
    const q = extractQueries("What did Maria say about the invoice for Acme?");
    expect(q[0]).toBe("invoice maria acme".split(" ").sort((a, b) => b.length - a.length).join(" "));
    expect(q).toContain("invoice");
    expect(q).toContain("acme");
  });
  it("keeps quoted phrases and addresses", () => {
    const q = extractQueries('emails from bob@corp.io about "Q3 budget"');
    expect(q).toContain('"Q3 budget"');
    expect(q).toContain("from:bob@corp.io");
  });
  it("uses the previous user turn for a bare follow-up", () => {
    const q = extractQueries("and the one before that?", [{ role: "user", content: "flight confirmation Lisbon" }, { role: "assistant", content: "..." }]);
    expect(q[0]).toContain("lisbon");
  });
  it("returns nothing when there is nothing to search", () => {
    expect(extractQueries("what is it?")).toEqual([]);
  });
});

describe("retrieve", () => {
  it("merges, ranks threads found by several queries first and caps at 20", async () => {
    const ctx = makeContext({
      searchForAi: async (q) => (q === "a" ? [hit(1), hit(2)] : [hit(3), hit(2), ...Array.from({ length: 30 }, (_, i) => hit(100 + i))]),
    });
    const out = await retrieve(ctx, ["a", "b"]);
    expect(out[0]!.threadId).toBe(2);
    expect(out).toHaveLength(20);
  });
  it("survives a failing query", async () => {
    const ctx = makeContext({ searchForAi: async (q) => { if (q === "bad") throw new Error("x"); return [hit(1)]; } });
    expect((await retrieve(ctx, ["bad", "ok"])).map((h) => h.threadId)).toEqual([1]);
  });
});

describe("buildAskContext and citedThreads", () => {
  it("numbers threads, gives the first ones message text and the rest snippets", async () => {
    const getThreadForAi = vi.fn(async () => ({ subject: "x", messages: [{ from, to: [], date: 1, text: "full body text" }] }));
    const ctx = makeContext({ getThreadForAi });
    const hits = Array.from({ length: 8 }, (_, i) => hit(i + 1));
    const text = await buildAskContext(ctx, hits);
    expect(text).toContain("[1] Subject: S1");
    expect(text).toContain("full body text");
    expect(text).toContain("snip8");
    expect(getThreadForAi).toHaveBeenCalledTimes(6);
  });
  it("lists cited threads in first-citation order, ignoring bad numbers", () => {
    const hits = [hit(10), hit(20), hit(30)];
    expect(citedThreads("A [3]. B [1, 3] and [9][2].", hits)).toEqual([
      { threadId: 30, subject: "S30" }, { threadId: 10, subject: "S10" }, { threadId: 20, subject: "S20" },
    ]);
    expect(citedThreads("no markers", hits)).toEqual([]);
  });
});

describe("extractQueries recall", () => {
  const now = Date.UTC(2026, 9, 25, 18, 0);
  it("does not AND six words together; searches keywords separately", () => {
    const q = extractQueries("What did Sarah say about the budget meeting next Tuesday?", [], now, "UTC");
    expect(q.every((x) => x.split(" ").length <= 3)).toBe(true);
    expect(q).toContain("budget");
    expect(q).toContain("sarah");
  });
  it("stems plurals", () => {
    const q = extractQueries("show me unpaid invoices from Acme", [], now, "UTC");
    expect(q).toContain("invoice");
    expect(q.join(" ")).not.toContain("invoices");
  });
  it("turns relative dates into filters", () => {
    expect(dateFilters("mail from yesterday", now, "UTC")).toEqual(["after:2026-10-24", "before:2026-10-25"]);
    expect(dateFilters("what came in last week", now, "UTC")).toEqual(["after:2026-10-18"]);
    expect(dateFilters("flights in March", now, "UTC")).toEqual(["after:2026-03-01", "before:2026-04-01"]);
    expect(dateFilters("flights in December", now, "UTC")).toEqual(["after:2025-12-01", "before:2026-01-01"]);
    expect(dateFilters("I may need that", now, "UTC")).toEqual([]);
    const q = extractQueries("invoice from acme last week", [], now, "UTC");
    expect(q.every((x) => x.includes("after:2026-10-18"))).toBe(true);
    expect(stripDateFilters(q[0]!)).not.toContain("after:");
  });
  it("uses only the date when the question has no keywords", () => {
    expect(extractQueries("what came in today?", [], now, "UTC")).toEqual(["after:2026-10-25"]);
  });
  it("uses the local day, not the UTC day, near midnight", () => {
    const evening = Date.UTC(2026, 9, 26, 3, 0); // 20:00 on the 25th in Los Angeles
    expect(dateFilters("today", evening, "America/Los_Angeles")).toEqual(["after:2026-10-25"]);
  });
});

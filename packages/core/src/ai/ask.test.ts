import { describe, expect, it, vi } from "vitest";
import { buildAskContext, citedThreads, extractQueries, retrieve, type Hit } from "./ask";
import { makeContext } from "./testing";

const from = { name: "Ana", address: "ana@x.com" };
const hit = (threadId: number, subject = `S${threadId}`): Hit => ({ threadId, subject, date: Date.UTC(2024, 4, 3), from, snippet: `snip${threadId}` });

describe("extractQueries", () => {
  it("drops stopwords and joins keywords", () => {
    const q = extractQueries("What did Maria say about the invoice for Acme?");
    expect(q[0]).toBe("maria say invoice acme");
    expect(q.length).toBeLessThanOrEqual(3);
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

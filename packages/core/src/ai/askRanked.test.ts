import { describe, expect, it, vi } from "vitest";
import { planAsk } from "./ask-plan";
import { extractSearchPlan, retrieveRanked } from "./ask";
import { makeContext } from "./testing";

const from = { name: "Ana", address: "ana@x.com" };
const hit = (threadId: number) => ({ threadId, subject: `S${threadId}`, date: 1, from, snippet: `snip${threadId}` });
const NOW = new Date(2026, 9, 25, 12).getTime();

describe("extractSearchPlan", () => {
  it("turns a natural question into stemmed terms, not one long AND", () => {
    const p = extractSearchPlan("What did Sarah say about the budget meetings next Tuesday?", [], NOW, "UTC")!;
    expect(p.terms).toEqual(expect.arrayContaining(["sarah", "budget", "meeting", "tuesday"]));
    expect(p.terms).not.toContain("meetings");
  });
  it("keeps phrases, senders and a date window as structure", () => {
    const p = extractSearchPlan('invoices from bob@corp.io about "Q3 budget" yesterday', [], NOW, "UTC")!;
    expect(p.phrases).toEqual(["Q3 budget"]);
    expect(p.from).toEqual(["bob@corp.io"]);
    expect(p.after).toBe(new Date(2026, 9, 24).getTime());
    expect(p.before).toBe(new Date(2026, 9, 25).getTime());
  });
  it("borrows words from the previous question for a bare follow-up", () => {
    const p = extractSearchPlan("and the one before that?", [{ role: "user", content: "flight confirmation Lisbon" }], NOW, "UTC")!;
    expect(p.terms).toContain("lisbon");
  });
  it("returns null when there is nothing to search", () => {
    expect(extractSearchPlan("what is it?", [], NOW, "UTC")).toBeNull();
  });
});

describe("planAsk with ranked retrieval", () => {
  it("uses the ranked search, de-duplicates threads and keeps citations aligned with the numbering", async () => {
    const ranked = vi.fn(async () => [hit(7), hit(7), hit(3)]);
    const ctx = makeContext({ timeZone: "UTC", rankedSearchForAi: ranked, getThreadForAi: async () => ({ subject: "x", messages: [{ from, to: [], date: 1, text: "body" }] }) });
    const { plan, hits } = await planAsk({ kind: "ask", question: "what about the budget?" }, ctx);
    expect(hits.map((h) => h.threadId)).toEqual([7, 3]);
    expect(plan.messages.at(-1)!.content).toContain("[1] Subject: S7");
    expect(plan.citations).toBeUndefined();
    expect(ranked).toHaveBeenCalledTimes(1);
  });

  it("retries without the date window when it finds nothing", async () => {
    const ranked = vi.fn(async (q: { after?: number }) => (q.after !== undefined ? [] : [hit(1)]));
    const ctx = makeContext({ timeZone: "UTC", rankedSearchForAi: ranked, getThreadForAi: async () => null });
    const { hits } = await planAsk({ kind: "ask", question: "budget from last week" }, ctx);
    expect(hits.map((h) => h.threadId)).toEqual([1]);
    expect(ranked).toHaveBeenCalledTimes(2);
  });

  it("falls back to the plain search when the host has no ranked search", async () => {
    const ctx = makeContext({ timeZone: "UTC", searchForAi: async () => [hit(2)], getThreadForAi: async () => null });
    expect((await planAsk({ kind: "ask", question: "budget" }, ctx)).hits).toHaveLength(1);
  });

  it("retrieveRanked survives a failing search", async () => {
    const ctx = makeContext({ rankedSearchForAi: async () => { throw new Error("x"); } });
    expect(await retrieveRanked(ctx, { terms: ["a"], phrases: [], from: [] })).toEqual([]);
  });
});

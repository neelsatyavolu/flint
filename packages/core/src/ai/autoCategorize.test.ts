import { describe, expect, it, vi } from "vitest";
import { FlintError } from "../types";
import { baseSettings } from "./testing";
import { buildCategorizeRequest, createAutoCategorizer, parseVerdicts, type CategorizeCandidate, type CategorizerPorts } from "./autoCategorize";

const cand = (i: number, over: Partial<CategorizeCandidate> = {}): CategorizeCandidate => ({
  messageId: i, threadId: 100 + i, from: { name: "Admissions", address: `admissions${i}@uni${i}.edu` }, subject: `Update ${i}`,
  text: "Apply now. To unsubscribe click here.", headers: {}, isReply: false, html: false, date: 1, ...over,
});

function setup(list: CategorizeCandidate[], answer: (user: string) => string, ai: Parameters<typeof baseSettings>[0] = {}) {
  const cache = new Map<string, string>();
  let clock = 1_000_000;
  const applied: { messageId: number; category: string }[] = [];
  const complete = vi.fn(async (_s: string, user: string) => answer(user));
  const onChanged = vi.fn();
  const ports: CategorizerPorts = {
    getSettings: () => baseSettings(ai),
    now: () => clock,
    candidates: () => list,
    apply: (v) => { applied.push(...v); return [...new Set(v.map((x) => 100 + x.messageId))]; },
    cacheGet: (k) => cache.get(k) ?? null,
    cacheSet: (k, v) => { cache.set(k, v); },
    complete, onChanged,
  };
  return { ports, complete, onChanged, applied, cache, advance: (ms: number) => { clock += ms; } };
}

const allNewsletters = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i + 1, category: "newsletters" })));

describe("parseVerdicts", () => {
  it("reads fenced JSON and rejects junk", () => {
    expect(parseVerdicts('```json\n[{"id":1,"category":"people"}]\n```')).toEqual([{ id: 1, category: "people" }]);
    expect(() => parseVerdicts('[{"id":1,"category":"spam"}]')).toThrow();
    expect(() => parseVerdicts("sorry")).toThrow();
  });
});

describe("buildCategorizeRequest", () => {
  it("carries sender, subject, 300 characters and key headers only", () => {
    const text = buildCategorizeRequest([cand(1, { text: "x".repeat(900), headers: { "list-unsubscribe": "<mailto:a@b>", "x-secret": "no" } })]);
    expect(text).toContain("[1] From: Admissions <admissions1@uni1.edu>");
    expect(text).toContain("Headers: list-unsubscribe: yes");
    expect(text).not.toContain("x-secret");
    expect(text).not.toContain("x".repeat(301));
  });
});

describe("createAutoCategorizer", () => {
  it("does nothing while the setting is off", async () => {
    const s = setup([cand(1)], () => "[]", { autoCategorize: false });
    expect(await createAutoCategorizer(s.ports).runOnce()).toEqual({ status: "off" });
    expect(s.complete).not.toHaveBeenCalled();
  });

  it("asks once for up to 20 uncertain messages and stores bulk verdicts", async () => {
    const s = setup(Array.from({ length: 25 }, (_, i) => cand(i + 1)), (u) => allNewsletters((u.match(/^\[\d+\]/gm) ?? []).length));
    const result = await createAutoCategorizer(s.ports).runOnce();
    expect(result).toMatchObject({ status: "asked", sent: 20 });
    expect(s.complete).toHaveBeenCalledTimes(1);
    expect(s.applied).toHaveLength(20);
    expect(s.onChanged).toHaveBeenCalledTimes(1);
  });

  it("skips mail the heuristics are sure about and mail already checked", async () => {
    const ordinary = cand(1, { from: { name: "Priya Shah", address: "priya@gmail.com" }, subject: "dinner", text: "Are you around?" });
    const s = setup([ordinary, cand(2)], () => allNewsletters(1));
    const c = createAutoCategorizer(s.ports, { minGapMs: 0 });
    expect(await c.runOnce()).toMatchObject({ status: "asked", sent: 1 });
    expect(await c.runOnce()).toEqual({ status: "idle" });
  });

  it("keeps people verdicts as they are but remembers them", async () => {
    const s = setup([cand(1)], () => JSON.stringify([{ id: 1, category: "people" }]));
    await createAutoCategorizer(s.ports).runOnce();
    expect(s.applied).toEqual([]);
    expect(s.cache.get("ai:cat:s:admissions1@uni1.edu")).toBe("people");
  });

  it("reuses a sender's earlier verdict without asking again", async () => {
    const first = cand(1, { from: { name: "Scoir", address: "hello@mail.scoir.com" } });
    const second = cand(2, { from: { name: "Scoir", address: "hello@mail.scoir.com" } });
    const s = setup([first], () => allNewsletters(1));
    const c = createAutoCategorizer(s.ports, { minGapMs: 0 });
    await c.runOnce();
    s.ports.candidates = () => [second];
    expect(await c.runOnce()).toMatchObject({ status: "memo" });
    expect(s.complete).toHaveBeenCalledTimes(1);
    expect(s.applied.map((a) => a.messageId)).toEqual([1, 2]);
  });

  it("rate limits by gap and by hour", async () => {
    const s = setup(Array.from({ length: 200 }, (_, i) => cand(i + 1)), (u) => allNewsletters((u.match(/^\[\d+\]/gm) ?? []).length));
    const c = createAutoCategorizer(s.ports, { minGapMs: 30_000, maxPerHour: 2 });
    expect((await c.runOnce()).status).toBe("asked");
    expect((await c.runOnce()).status).toBe("rate_limited");
    s.advance(31_000);
    expect((await c.runOnce()).status).toBe("asked");
    s.advance(31_000);
    expect((await c.runOnce()).status).toBe("rate_limited");
    s.advance(3_600_000);
    expect((await c.runOnce()).status).toBe("asked");
  });

  it("pauses when AI is not connected and marks unreadable answers so they are not retried", async () => {
    const s = setup([cand(1)], () => { throw new FlintError("ai_not_connected", "x"); });
    const c = createAutoCategorizer(s.ports, { minGapMs: 0 });
    expect(await c.runOnce()).toMatchObject({ status: "failed" });
    expect(await c.runOnce()).toEqual({ status: "paused" });
    const t = setup([cand(1)], () => "I cannot do that");
    const d = createAutoCategorizer(t.ports, { minGapMs: 0 });
    expect(await d.runOnce()).toMatchObject({ status: "failed", reason: "unreadable answer" });
    expect(await d.runOnce()).toEqual({ status: "idle" });
  });

  it("ignores ids the model made up", async () => {
    const s = setup([cand(1)], () => JSON.stringify([{ id: 7, category: "newsletters" }]));
    await createAutoCategorizer(s.ports).runOnce();
    expect(s.applied).toEqual([]);
  });
});

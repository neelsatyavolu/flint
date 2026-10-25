import { describe, expect, it } from "vitest";
import type { Signature } from "@flint/core";
import { mapAfterDelete, planSignatureSave } from "./signatureDefaults";

const sig = (over: Partial<Signature> & { id: number }): Signature => ({ name: "S", html: "", accountId: "a", defaultNew: false, defaultReply: false, ...over });

describe("planSignatureSave", () => {
  it("takes the new-mail default from another signature on the same account", () => {
    const all = [sig({ id: 1, defaultNew: true, defaultReply: true }), sig({ id: 2 })];
    const saved = sig({ id: 2, defaultNew: true });
    const plan = planSignatureSave(all, saved, { a: 1 });
    expect(plan.demote).toEqual([{ ...all[0], defaultNew: false }]);
    expect(plan.map).toEqual({ a: 2 });
  });

  it("takes the reply default without touching the new-mail default", () => {
    const all = [sig({ id: 1, defaultNew: true, defaultReply: true }), sig({ id: 2 })];
    const plan = planSignatureSave(all, sig({ id: 2, defaultReply: true }), { a: 1 });
    expect(plan.demote).toEqual([{ ...all[0], defaultReply: false }]);
    expect(plan.map).toBeNull();
  });

  it("ignores signatures that belong to other accounts", () => {
    const all = [sig({ id: 1, accountId: "b", defaultNew: true }), sig({ id: 2 })];
    expect(planSignatureSave(all, sig({ id: 2, defaultNew: true }), { b: 1 }).demote).toEqual([]);
  });

  it("clears the account default when the flag is removed", () => {
    const plan = planSignatureSave([sig({ id: 1 })], sig({ id: 1, defaultNew: false }), { a: 1 });
    expect(plan.map).toEqual({ a: null });
  });

  it("does not touch the map for all-accounts signatures", () => {
    const plan = planSignatureSave([], sig({ id: 1, accountId: null, defaultNew: true }), {});
    expect(plan.map).toBeNull();
  });
});

describe("mapAfterDelete", () => {
  it("nulls entries pointing at the deleted signature", () => {
    expect(mapAfterDelete({ a: 1, b: 2 }, 1)).toEqual({ a: null, b: 2 });
    expect(mapAfterDelete({ a: 1 }, 9)).toBeNull();
  });
});

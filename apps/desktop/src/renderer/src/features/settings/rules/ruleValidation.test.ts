import { describe, expect, it } from "vitest";
import type { Rule } from "@flint/core";
import { hasIssues, newAction, newRule, reorder, summarizeRule, validateRule, withField } from "./ruleValidation";

describe("validateRule", () => {
  it("flags an empty draft", () => {
    const issues = validateRule(newRule(0));
    expect(issues.name).toBe("Name the rule.");
    expect(issues.conditions[0]).toBe("Enter a value.");
    expect(hasIssues(issues)).toBe(true);
  });

  it("passes a complete rule", () => {
    const r = { ...newRule(0), name: "Receipts", conditions: [{ field: "from" as const, op: "contains" as const, value: "stripe" }] };
    expect(hasIssues(validateRule(r))).toBe(false);
  });

  it("rejects an invalid pattern", () => {
    const r = { ...newRule(0), name: "x", conditions: [{ field: "subject" as const, op: "matches" as const, value: "(" }] };
    expect(validateRule(r).conditions[0]).toBe("That pattern isn't valid.");
  });

  it("needs no value for has_attachment", () => {
    const r = { ...newRule(0), name: "x", conditions: [{ field: "has_attachment" as const, op: "is_true" as const, value: "" }] };
    expect(validateRule(r).conditions[0]).toBeNull();
  });

  it("requires conditions, actions and a move folder", () => {
    const none = validateRule({ ...newRule(0), name: "x", conditions: [], actions: [] });
    expect(none.general).toEqual(["Add at least one condition.", "Add at least one action."]);
    const move = validateRule({ ...newRule(0), name: "x", conditions: [{ field: "from", op: "contains", value: "a" }], actions: [newAction("move")] });
    expect(move.actions[0]).toBe("Enter a folder.");
  });

  it("rejects an operator that does not apply", () => {
    const r = { ...newRule(0), name: "x", conditions: [{ field: "has_attachment" as const, op: "contains" as const, value: "x" }] };
    expect(validateRule(r).conditions[0]).toMatch(/doesn't apply/);
  });
});

describe("withField", () => {
  it("resets the operator and value for has_attachment", () => {
    expect(withField({ field: "from", op: "contains", value: "a" }, "has_attachment")).toEqual({ field: "has_attachment", op: "is_true", value: "" });
  });
  it("keeps the operator when it still applies", () => {
    expect(withField({ field: "from", op: "equals", value: "a" }, "subject")).toEqual({ field: "subject", op: "equals", value: "a" });
  });
});

describe("reorder", () => {
  const mk = (id: number, sortOrder: number): Rule => ({ id, name: String(id), enabled: true, accountId: null, match: "all", conditions: [], actions: [], sortOrder });
  it("swaps with the neighbour", () => {
    const out = reorder([mk(1, 0), mk(2, 1)], 2, -1);
    expect(out?.map((r) => [r.id, r.sortOrder])).toEqual([[2, 0], [1, 1]]);
  });
  it("returns null at the edge", () => {
    expect(reorder([mk(1, 0), mk(2, 1)], 1, -1)).toBeNull();
  });
  it("separates equal sort orders", () => {
    const out = reorder([mk(1, 0), mk(2, 0)], 2, -1);
    expect(out && out[0].sortOrder !== out[1].sortOrder).toBe(true);
  });
});

describe("summarizeRule", () => {
  it("reads as a sentence", () => {
    const s = summarizeRule({ match: "all", conditions: [{ field: "from", op: "contains", value: "stripe" }], actions: [{ type: "archive" }, { type: "mark_read" }] });
    expect(s).toBe("If from contains stripe: archive, mark as read");
  });
});

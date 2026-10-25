import { describe, expect, it } from "vitest";
import type { Rule, RuleCondition } from "../types";
import { evaluateRules, matchCondition, matchRule, normalizeBlockPattern, resolveCategory, senderMatchesBlocked, type RuleMessage } from "./index";

const msg = (over: Partial<RuleMessage> = {}): RuleMessage => ({
  accountId: "a1",
  from: [{ name: "Stripe", address: "receipts@stripe.com" }],
  to: [{ name: "Me", address: "me@x.com" }],
  cc: [{ name: "", address: "boss@x.com" }],
  subject: "Your receipt from Acme",
  body: "Total: $12.00. Thanks for your order.",
  headers: { "list-id": "<billing.stripe.com>" },
  hasAttachments: false,
  ...over,
});
const cond = (field: RuleCondition["field"], op: RuleCondition["op"], value = ""): RuleCondition => ({ field, op, value });
const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 1, name: "r", enabled: true, accountId: null, match: "all", sortOrder: 0,
  conditions: [cond("from", "contains", "stripe")], actions: [{ type: "archive" }], ...over,
});

describe("matchCondition", () => {
  it("contains is case-insensitive over name and address", () => {
    expect(matchCondition(cond("from", "contains", "STRIPE"), msg())).toBe(true);
    expect(matchCondition(cond("from", "contains", "paypal"), msg())).toBe(false);
  });
  it("equals compares a whole address or name", () => {
    expect(matchCondition(cond("from", "equals", "receipts@stripe.com"), msg())).toBe(true);
    expect(matchCondition(cond("from", "equals", "stripe"), msg())).toBe(true);
    expect(matchCondition(cond("from", "equals", "stripe.com"), msg())).toBe(false);
    expect(matchCondition(cond("subject", "equals", "your receipt from acme"), msg())).toBe(true);
  });
  it("ends_with on addresses checks the address", () => {
    expect(matchCondition(cond("from", "ends_with", "@stripe.com"), msg())).toBe(true);
    expect(matchCondition(cond("to", "ends_with", "@stripe.com"), msg())).toBe(false);
    expect(matchCondition(cond("subject", "ends_with", "acme"), msg())).toBe(true);
  });
  it("covers to, cc, any_recipient, body, list_id", () => {
    expect(matchCondition(cond("to", "contains", "me@x"), msg())).toBe(true);
    expect(matchCondition(cond("cc", "contains", "boss"), msg())).toBe(true);
    expect(matchCondition(cond("any_recipient", "contains", "boss"), msg())).toBe(true);
    expect(matchCondition(cond("any_recipient", "contains", "ghost"), msg({ bcc: [{ name: "", address: "ghost@x.com" }] }))).toBe(true);
    expect(matchCondition(cond("body", "contains", "total: $12"), msg())).toBe(true);
    expect(matchCondition(cond("list_id", "contains", "billing"), msg())).toBe(true);
    expect(matchCondition(cond("list_id", "contains", "billing"), msg({ headers: {} }))).toBe(false);
  });
  it("matches uses a case-insensitive regex and tolerates bad patterns", () => {
    expect(matchCondition(cond("subject", "matches", "^your .* acme$"), msg())).toBe(true);
    expect(matchCondition(cond("subject", "matches", "("), msg())).toBe(false);
    expect(matchCondition(cond("subject", "matches", "a".repeat(300)), msg())).toBe(false);
  });
  it("has_attachment needs is_true", () => {
    expect(matchCondition(cond("has_attachment", "is_true"), msg({ hasAttachments: true }))).toBe(true);
    expect(matchCondition(cond("has_attachment", "is_true"), msg())).toBe(false);
    expect(matchCondition(cond("has_attachment", "contains", "x"), msg({ hasAttachments: true }))).toBe(false);
  });
  it("an empty value never matches contains", () => {
    expect(matchCondition(cond("subject", "contains", ""), msg())).toBe(false);
  });
});

describe("matchRule and evaluateRules", () => {
  it("all vs any", () => {
    const conds = [cond("from", "contains", "stripe"), cond("subject", "contains", "nope")];
    expect(matchRule(rule({ conditions: conds, match: "all" }), msg())).toBe(false);
    expect(matchRule(rule({ conditions: conds, match: "any" }), msg())).toBe(true);
  });
  it("skips disabled, empty and other-account rules", () => {
    expect(matchRule(rule({ enabled: false }), msg())).toBe(false);
    expect(matchRule(rule({ conditions: [] }), msg())).toBe(false);
    expect(matchRule(rule({ accountId: "a2" }), msg())).toBe(false);
    expect(matchRule(rule({ accountId: "a1" }), msg())).toBe(true);
  });
  it("collects actions in rule order and resolves category", () => {
    const rules = [
      rule({ id: 2, sortOrder: 2, actions: [{ type: "category", category: "notifications" }] }),
      rule({ id: 1, sortOrder: 1, actions: [{ type: "mark_read" }, { type: "category", category: "newsletters" }] }),
      rule({ id: 3, sortOrder: 3, conditions: [cond("from", "contains", "zzz")], actions: [{ type: "trash" }] }),
    ];
    const actions = evaluateRules(rules, msg());
    expect(actions.map((a) => a.type)).toEqual(["mark_read", "category", "category"]);
    expect(resolveCategory(actions, "people")).toBe("notifications");
    expect(resolveCategory([], "people")).toBe("people");
  });
});

describe("blocked senders", () => {
  it("matches exact address and @domain", () => {
    const set = new Set(["spam@x.com", "@evil.org"]);
    expect(senderMatchesBlocked("SPAM@x.com", set)).toBe(true);
    expect(senderMatchesBlocked("anyone@evil.org", set)).toBe(true);
    expect(senderMatchesBlocked("anyone@good.org", set)).toBe(false);
    expect(senderMatchesBlocked("", set)).toBe(false);
    expect(senderMatchesBlocked("a@b.c", new Set())).toBe(false);
  });
  it("normalizes patterns", () => {
    expect(normalizeBlockPattern(" Spam@X.com ")).toBe("spam@x.com");
    expect(normalizeBlockPattern("evil.org")).toBe("@evil.org");
    expect(normalizeBlockPattern("@evil.org")).toBe("@evil.org");
    expect(normalizeBlockPattern("<a@b.co>")).toBe("a@b.co");
    expect(normalizeBlockPattern("nonsense")).toBeNull();
    expect(normalizeBlockPattern("")).toBeNull();
    expect(normalizeBlockPattern("@")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { loadFixture } from "../../fixtures";
import type { Rule, RuleAction, RuleCondition } from "../types";
import { evaluateRules, matchCondition, matchRule, normalizeBlockPattern, resolveCategory, senderMatchesBlocked, type RuleMessage } from "./index";

type Input =
  | { fn: "matchCondition"; condition: RuleCondition; message: RuleMessage }
  | { fn: "matchRule"; rule: Rule; message: RuleMessage }
  | { fn: "evaluateRules"; rules: Rule[]; message: RuleMessage }
  | { fn: "resolveCategory"; actions: RuleAction[]; fallback: "people" }
  | { fn: "senderMatchesBlocked"; sender: string; blocked: string[] }
  | { fn: "normalizeBlockPattern"; value: string };
const fixture = loadFixture<Input, unknown>("rules");

describe("rules fixtures", () => {
  it.each(fixture.cases)("$name", ({ input, expect: want }) => {
    switch (input.fn) {
      case "matchCondition": return expect(matchCondition(input.condition, input.message)).toBe(want);
      case "matchRule": return expect(matchRule(input.rule, input.message)).toBe(want);
      case "evaluateRules": return expect(evaluateRules(input.rules, input.message)).toEqual(want);
      case "resolveCategory": return expect(resolveCategory(input.actions, input.fallback)).toBe(want);
      case "senderMatchesBlocked": return expect(senderMatchesBlocked(input.sender, new Set(input.blocked))).toBe(want);
      case "normalizeBlockPattern": return expect(normalizeBlockPattern(input.value)).toBe(want);
    }
  });
});

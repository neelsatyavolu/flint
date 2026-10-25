import { z } from "zod";
import { normalizeBlockPattern } from "../rules";
import { FlintError, type Rule } from "../types";
import { parseJson } from "./sql";
import type { Sql } from "./sql";

const conditionSchema = z.object({
  field: z.enum(["from", "to", "cc", "subject", "body", "any_recipient", "list_id", "has_attachment"]),
  op: z.enum(["contains", "equals", "ends_with", "matches", "is_true"]),
  value: z.string().max(500),
});
const categorySchema = z.enum(["people", "notifications", "newsletters"]);
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), folderPath: z.string().min(1) }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("trash") }),
  z.object({ type: z.literal("mark_read") }),
  z.object({ type: z.literal("pin") }),
  z.object({ type: z.literal("category"), category: categorySchema }),
  z.object({ type: z.literal("mute") }),
  z.object({ type: z.literal("notify"), enabled: z.boolean() }),
]);
export const ruleInputSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  accountId: z.string().nullable(),
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).max(20),
  actions: z.array(actionSchema).min(1).max(10),
  sortOrder: z.number().int(),
});

type RuleRow = { id: number; name: string; enabled: number; account_id: string | null; match: string; conditions_json: string; actions_json: string; sort_order: number };

const toRule = (r: RuleRow): Rule => ({
  id: r.id, name: r.name, enabled: r.enabled === 1, accountId: r.account_id, match: r.match === "any" ? "any" : "all",
  conditions: parseJson(r.conditions_json, []), actions: parseJson(r.actions_json, []), sortOrder: r.sort_order,
});

export class RulesRepo {
  constructor(protected q: Sql) {}

  listRules(): Rule[] {
    return this.q.all<RuleRow>("SELECT * FROM rules ORDER BY sort_order, id").map(toRule);
  }

  getRule(id: number): Rule | null {
    const r = this.q.get<RuleRow>("SELECT * FROM rules WHERE id = ?", id);
    return r ? toRule(r) : null;
  }

  /** Enabled rules that apply to this account. */
  listRulesFor(accountId: string): Rule[] {
    return this.listRules().filter((r) => r.enabled && (r.accountId === null || r.accountId === accountId));
  }

  saveRule(input: Omit<Rule, "id"> & { id?: number }): Rule {
    const parsed = ruleInputSchema.safeParse(input);
    if (!parsed.success) throw new FlintError("invalid", "That rule is not valid.");
    const r = parsed.data;
    const cond = JSON.stringify(r.conditions);
    const act = JSON.stringify(r.actions);
    if (r.id !== undefined) {
      if (!this.getRule(r.id)) throw new FlintError("not_found", "That rule no longer exists.");
      this.q.run("UPDATE rules SET name=?, enabled=?, account_id=?, match=?, conditions_json=?, actions_json=?, sort_order=? WHERE id=?", r.name, r.enabled, r.accountId, r.match, cond, act, r.sortOrder, r.id);
      return this.getRule(r.id)!;
    }
    const id = this.q.run(
      "INSERT INTO rules (name, enabled, account_id, match, conditions_json, actions_json, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?)",
      r.name, r.enabled, r.accountId, r.match, cond, act, r.sortOrder, Date.now(),
    ).lastInsertRowid;
    return this.getRule(id)!;
  }

  deleteRule(id: number): void {
    this.q.run("DELETE FROM rules WHERE id = ?", id);
  }

  // Blocked senders

  /** Accepts an address, '@domain' or a bare domain. Returns the stored pattern. */
  blockSender(input: string): string {
    const pattern = normalizeBlockPattern(input);
    if (!pattern) throw new FlintError("invalid", "Enter an email address or a domain to block.");
    this.q.run("INSERT OR IGNORE INTO blocked_senders (pattern, created_at) VALUES (?, ?)", pattern, Date.now());
    return pattern;
  }

  unblockSender(input: string): string | null {
    const pattern = normalizeBlockPattern(input) ?? input.trim().toLowerCase();
    return this.q.run("DELETE FROM blocked_senders WHERE pattern = ?", pattern).changes > 0 ? pattern : null;
  }

  listBlocked(): { pattern: string; createdAt: number }[] {
    return this.q.all<{ pattern: string; created_at: number }>("SELECT pattern, created_at FROM blocked_senders ORDER BY created_at DESC, pattern")
      .map((r) => ({ pattern: r.pattern, createdAt: r.created_at }));
  }

  blockedPatterns(): Set<string> {
    return new Set(this.q.all<{ pattern: string }>("SELECT pattern FROM blocked_senders").map((r) => r.pattern));
  }
}

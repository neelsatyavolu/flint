import type { Category, Rule, RuleAction, RuleCondition, RuleField } from "@flint/core";

export type RuleDraft = Omit<Rule, "id"> & { id?: number };
export type RuleOp = RuleCondition["op"];

export const FIELD_LABELS: Record<RuleField, string> = {
  from: "From", to: "To", cc: "Cc", subject: "Subject", body: "Body", any_recipient: "Any recipient", list_id: "List-Id", has_attachment: "Has attachment",
};
export const OP_LABELS: Record<RuleOp, string> = { contains: "contains", equals: "is", ends_with: "ends with", matches: "matches pattern", is_true: "is true" };
export const FIELDS = Object.keys(FIELD_LABELS) as RuleField[];

export function opsFor(field: RuleField): RuleOp[] {
  return field === "has_attachment" ? ["is_true"] : ["contains", "equals", "ends_with", "matches"];
}

export function newCondition(): RuleCondition {
  return { field: "from", op: "contains", value: "" };
}

/** Changing the field keeps the operator when it still applies; has_attachment has no value. */
export function withField(c: RuleCondition, field: RuleField): RuleCondition {
  const ops = opsFor(field);
  const op = ops.includes(c.op) ? c.op : ops[0]!;
  return { field, op, value: field === "has_attachment" ? "" : c.value };
}

export const ACTION_LABELS: Record<RuleAction["type"], string> = {
  move: "Move to folder", archive: "Archive", trash: "Move to trash", mark_read: "Mark as read", pin: "Pin", category: "File as", mute: "Mute", notify: "Notification",
};
export const ACTION_TYPES = Object.keys(ACTION_LABELS) as RuleAction["type"][];
export const CATEGORY_LABELS: Record<Category, string> = { people: "People", notifications: "Notifications", newsletters: "Newsletters" };

export function newAction(type: RuleAction["type"]): RuleAction {
  switch (type) {
    case "move": return { type, folderPath: "" };
    case "category": return { type, category: "newsletters" };
    case "notify": return { type, enabled: false };
    default: return { type } as RuleAction;
  }
}

export function newRule(sortOrder: number): RuleDraft {
  return { name: "", enabled: true, accountId: null, match: "all", conditions: [newCondition()], actions: [newAction("archive")], sortOrder };
}

export type RuleIssues = { name: string | null; conditions: (string | null)[]; actions: (string | null)[]; general: string[] };

export function validateRule(rule: RuleDraft): RuleIssues {
  const general: string[] = [];
  if (rule.conditions.length === 0) general.push("Add at least one condition.");
  if (rule.actions.length === 0) general.push("Add at least one action.");
  return {
    name: rule.name.trim() === "" ? "Name the rule." : null,
    conditions: rule.conditions.map((c) => {
      if (!opsFor(c.field).includes(c.op)) return "This test doesn't apply to that field.";
      if (c.op === "is_true") return null;
      if (c.value.trim() === "") return "Enter a value.";
      if (c.op === "matches") {
        try {
          new RegExp(c.value);
        } catch {
          return "That pattern isn't valid.";
        }
      }
      return null;
    }),
    actions: rule.actions.map((a) => (a.type === "move" && a.folderPath.trim() === "" ? "Enter a folder." : null)),
    general,
  };
}

export function hasIssues(i: RuleIssues): boolean {
  return i.name !== null || i.general.length > 0 || i.conditions.some(Boolean) || i.actions.some(Boolean);
}

export function summarizeRule(r: Pick<Rule, "conditions" | "actions" | "match">): string {
  const conds = r.conditions.map((c) => (c.op === "is_true" ? FIELD_LABELS[c.field].toLowerCase() : `${FIELD_LABELS[c.field].toLowerCase()} ${OP_LABELS[c.op]} ${c.value}`));
  const acts = r.actions.map((a) => (a.type === "move" ? `move to ${a.folderPath}` : a.type === "category" ? `file as ${a.category}` : a.type === "notify" ? (a.enabled ? "notify" : "no notification") : ACTION_LABELS[a.type].toLowerCase()));
  return `If ${conds.join(r.match === "all" ? " and " : " or ") || "nothing"}: ${acts.join(", ") || "nothing"}`;
}

/** Swaps sortOrder with the neighbour. Returns the two rules to save, or null at the edge. */
export function reorder(rules: Rule[], id: number, dir: -1 | 1): [Rule, Rule] | null {
  const sorted = [...rules].sort((a, b) => a.sortOrder - b.sortOrder);
  const i = sorted.findIndex((r) => r.id === id);
  const j = i + dir;
  const a = sorted[i];
  const b = sorted[j];
  if (!a || !b) return null;
  const aOrder = a.sortOrder === b.sortOrder ? (dir === -1 ? b.sortOrder + 1 : b.sortOrder - 1) : a.sortOrder;
  return [{ ...a, sortOrder: b.sortOrder }, { ...b, sortOrder: aOrder }];
}

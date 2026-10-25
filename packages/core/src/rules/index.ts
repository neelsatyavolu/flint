import type { Address, Category, Rule, RuleAction, RuleCondition } from "../types";

/** What a rule can look at. `body` is plain text. Header names are lowercase. */
export type RuleMessage = {
  accountId: string;
  from: Address[];
  to: Address[];
  cc: Address[];
  bcc?: Address[];
  subject: string;
  body: string;
  headers: Record<string, string>;
  hasAttachments: boolean;
};

const MAX_PATTERN = 200;
const MAX_HAYSTACK = 200_000;

const label = (a: Address) => `${a.name} <${a.address}>`.toLowerCase();

function haystacks(field: RuleCondition["field"], m: RuleMessage): string[] {
  switch (field) {
    case "from": return m.from.map(label);
    case "to": return m.to.map(label);
    case "cc": return m.cc.map(label);
    case "any_recipient": return [...m.to, ...m.cc, ...(m.bcc ?? [])].map(label);
    case "subject": return [m.subject.toLowerCase()];
    case "body": return [m.body.slice(0, MAX_HAYSTACK).toLowerCase()];
    case "list_id": return [(m.headers["list-id"] ?? "").toLowerCase()];
    case "has_attachment": return [];
  }
}

const isAddressField = (f: RuleCondition["field"]) => f === "from" || f === "to" || f === "cc" || f === "any_recipient";

function addressesFor(field: RuleCondition["field"], m: RuleMessage): Address[] {
  if (field === "from") return m.from;
  if (field === "to") return m.to;
  if (field === "cc") return m.cc;
  return [...m.to, ...m.cc, ...(m.bcc ?? [])];
}

export function matchCondition(c: RuleCondition, m: RuleMessage): boolean {
  if (c.field === "has_attachment") return c.op === "is_true" ? m.hasAttachments : false;
  const value = c.value.toLowerCase();
  if (!value && c.op !== "matches") return false;

  if (c.op === "equals" && isAddressField(c.field)) {
    return addressesFor(c.field, m).some((a) => a.address.toLowerCase() === value || a.name.toLowerCase() === value);
  }
  if (c.op === "ends_with" && isAddressField(c.field)) {
    return addressesFor(c.field, m).some((a) => a.address.toLowerCase().endsWith(value));
  }
  const hay = haystacks(c.field, m);
  switch (c.op) {
    case "contains": return hay.some((h) => h.includes(value));
    case "equals": return hay.some((h) => h === value);
    case "ends_with": return hay.some((h) => h.endsWith(value));
    case "matches": return hay.some((h) => safeRegex(c.value, h));
    case "is_true": return false;
  }
}

function safeRegex(pattern: string, text: string): boolean {
  if (!pattern || pattern.length > MAX_PATTERN) return false;
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return false;
  }
}

/** A rule with no conditions never matches. */
export function matchRule(rule: Rule, m: RuleMessage): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false;
  if (rule.accountId !== null && rule.accountId !== m.accountId) return false;
  return rule.match === "all"
    ? rule.conditions.every((c) => matchCondition(c, m))
    : rule.conditions.some((c) => matchCondition(c, m));
}

/** Actions of every matching rule, in rule order (sortOrder, then id). Later category actions win via resolveCategory. */
export function evaluateRules(rules: readonly Rule[], m: RuleMessage): RuleAction[] {
  return [...rules]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .filter((r) => matchRule(r, m))
    .flatMap((r) => r.actions);
}

export function resolveCategory(actions: readonly RuleAction[], fallback: Category): Category {
  let out = fallback;
  for (const a of actions) if (a.type === "category") out = a.category;
  return out;
}

/** True when a lowercase address matches a blocked pattern: exact address or '@domain'. */
export function senderMatchesBlocked(address: string, patterns: ReadonlySet<string>): boolean {
  const a = address.trim().toLowerCase();
  if (!a || patterns.size === 0) return false;
  if (patterns.has(a)) return true;
  const at = a.lastIndexOf("@");
  return at >= 0 && patterns.has(a.slice(at));
}

/** Normalizes user input into a stored pattern: lowercase address, or '@domain' for a bare domain. */
export function normalizeBlockPattern(input: string): string | null {
  const v = input.trim().toLowerCase().replace(/^<|>$/g, "");
  if (!v) return null;
  if (v.startsWith("@")) return /^@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
  if (v.includes("@")) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
  return /^[^@\s]+\.[^@\s]+$/.test(v) ? `@${v}` : null;
}

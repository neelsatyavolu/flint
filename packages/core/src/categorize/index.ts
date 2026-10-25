import type { Address, Category } from "../types";

export type CategorizeInput = {
  from: Address | null;
  /** Lowercase header names. Only the list and auto-submit headers matter here. */
  headers: Record<string, string>;
  /** True when the sender is the user or a contact the user has written to (sent_count > 0). */
  isKnownContact: boolean;
};

const AUTOMATED_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|alerts?|updates?|mailer-daemon|bounces?|info|support|team|hello)([-_.+0-9].*)?$/;
const BULK_PRECEDENCE = /^(bulk|list|junk)$/;

function header(headers: Record<string, string>, name: string): string {
  return (headers[name] ?? "").trim();
}

/** SPEC section 4: people always wins for known contacts, then list headers mean newsletters, then automated senders mean notifications. */
export function categorize(input: CategorizeInput): Category {
  if (input.isKnownContact) return "people";
  const { headers } = input;
  if (header(headers, "list-unsubscribe") || header(headers, "list-id")) return "newsletters";

  const local = (input.from?.address ?? "").toLowerCase().split("@")[0] ?? "";
  if (AUTOMATED_LOCAL.test(local)) return "notifications";
  const auto = header(headers, "auto-submitted").toLowerCase();
  if (auto && auto !== "no") return "notifications";
  if (BULK_PRECEDENCE.test(header(headers, "precedence").toLowerCase())) return "notifications";
  return "people";
}

/** Thread category from its messages: any people message makes the thread people, otherwise the latest message decides. */
export function rollupCategory(messages: { category: Category | null; date: number }[]): Category {
  if (messages.length === 0) return "people";
  if (messages.some((m) => (m.category ?? "people") === "people")) return "people";
  const latest = messages.reduce((a, b) => (b.date >= a.date ? b : a));
  return latest.category ?? "people";
}

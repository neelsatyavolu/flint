import type { Address, Category } from "../types";

export type CategorizeInput = {
  from: Address | null;
  /** Lowercase header names. Only the list and auto-submit headers matter here. */
  headers: Record<string, string>;
  /** True when the sender is the user or a contact the user has written to (sent_count > 0). */
  isKnownContact: boolean;
};

const AUTOMATED_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|calendar[-_.]?notification|alerts?|updates?|mailer-daemon|bounces?|receipts?|billing|invoices?|statements?|orders?|order[-_.]?update|shipment[-_.]?tracking|shipping|service|dse|auto[-_.]?confirm)([-_.+0-9].*)?$/;
const BULK_PRECEDENCE = /^(bulk|list|junk)$/;
/** Senders whose list headers come from a notification stream, not a newsletter. */
const NOTIFICATION_DOMAIN = /(?:^|\.)(?:github\.com|gitlab\.com|linear\.app|linkedin\.com|atlassian\.net|atlassian\.com|slack\.com|bitbucket\.org)$/;

function header(headers: Record<string, string>, name: string): string {
  return (headers[name] ?? "").trim();
}

/** SPEC section 4: people always wins for known contacts, then notification signals, list headers (newsletters), then automated senders. */
export function categorize(input: CategorizeInput): Category {
  if (input.isKnownContact) return "people";
  const { headers } = input;
  const address = (input.from?.address ?? "").toLowerCase();
  const local = address.split("@")[0] ?? "";
  const domain = address.split("@")[1] ?? "";
  const auto = header(headers, "auto-submitted").toLowerCase();
  const hasAuto = auto !== "" && auto !== "no";
  const listId = header(headers, "list-id").toLowerCase();
  const unsubscribe = header(headers, "list-unsubscribe");

  if (hasAuto || header(headers, "x-github-reason") || header(headers, "x-auto-response-suppress")) return "notifications";
  if ((unsubscribe || listId) && NOTIFICATION_DOMAIN.test(domain)) return "notifications";
  if (NOTIFICATION_DOMAIN.test(listId.replace(/[<>\s]/g, ""))) return "notifications";
  const bulk = BULK_PRECEDENCE.test(header(headers, "precedence").toLowerCase());
  if (unsubscribe || listId) return "newsletters";
  if (AUTOMATED_LOCAL.test(local)) return "notifications";
  if (bulk) return "notifications";
  return "people";
}

/** Thread category from its messages: any people message makes the thread people, otherwise the latest message decides. */
export function rollupCategory(messages: { category: Category | null; date: number }[]): Category {
  if (messages.length === 0) return "people";
  if (messages.some((m) => (m.category ?? "people") === "people")) return "people";
  const latest = messages.reduce((a, b) => (b.date >= a.date ? b : a));
  return latest.category ?? "people";
}

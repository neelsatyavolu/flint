import type { Address, Category } from "../types";
import {
  ALWAYS_NOTIFY_DOMAIN, MIXED_DOMAIN, STRONG_LOCAL, TRANSACTIONAL_SUBJECT, WEAK_LOCAL, hasEspSignature, hasTransactionalHeader, subdomainClass,
} from "./signals";

/** Bump when categorize() changes so existing mail is re-labelled once (see service/recategorize). */
export const CATEGORIZER_VERSION = 2;

export type CategorizeInput = {
  from: Address | null;
  /** Lowercase header names. */
  headers: Record<string, string>;
  /** True when the sender is the user or a contact the user has written to (sent_count > 0). */
  isKnownContact: boolean;
  /** Optional: lets receipts and security alerts from mixed senders be told apart from marketing. */
  subject?: string;
};

const BULK_PRECEDENCE = /^(bulk|list|junk)$/;

function header(headers: Record<string, string>, name: string): string {
  return (headers[name] ?? "").trim();
}

/**
 * SPEC section 4. Known contacts are always people. Then transactional streams (notifications), marketing lists
 * (newsletters), and bulk senders without list headers (notifications). Everything else is people.
 */
export function categorize(input: CategorizeInput): Category {
  if (input.isKnownContact) return "people";
  const { headers } = input;
  const address = (input.from?.address ?? "").toLowerCase();
  const local = address.split("@")[0] ?? "";
  const domain = address.split("@")[1] ?? "";
  const listId = header(headers, "list-id").toLowerCase();
  const hasList = header(headers, "list-unsubscribe") !== "" || listId !== "" || header(headers, "list-post") !== "";
  const subject = input.subject ?? "";
  const transactionalSubject = TRANSACTIONAL_SUBJECT.test(subject);

  if (hasTransactionalHeader(headers)) return "notifications";
  if (ALWAYS_NOTIFY_DOMAIN.test(domain) || ALWAYS_NOTIFY_DOMAIN.test(listId.replace(/[<>\s]/g, ""))) return "notifications";

  const esp = hasEspSignature(headers);
  const bulkPrecedence = BULK_PRECEDENCE.test(header(headers, "precedence").toLowerCase());
  const bulk = hasList || esp || bulkPrecedence;
  const label = subdomainClass(domain);
  const strongLocal = STRONG_LOCAL.test(local);
  const automated = strongLocal || label === "strong" || (bulk && (WEAK_LOCAL.test(local) || label === "weak"));

  if (MIXED_DOMAIN.test(domain)) return transactionalSubject || !hasList ? "notifications" : "newsletters";
  if (transactionalSubject && (automated || bulk)) return "notifications";
  if (label === "news") return "newsletters";
  if (hasList) return label === "strong" ? "notifications" : "newsletters";
  if (automated || bulk) return "notifications";
  return "people";
}

/** Thread category from its messages: any people message makes the thread people, otherwise the latest message decides. */
export function rollupCategory(messages: { category: Category | null; date: number }[]): Category {
  if (messages.length === 0) return "people";
  if (messages.some((m) => (m.category ?? "people") === "people")) return "people";
  const latest = messages.reduce((a, b) => (b.date >= a.date ? b : a));
  return latest.category ?? "people";
}

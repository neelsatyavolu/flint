import type { Category, MessageView } from "@flint/core";

const NO_REPLY = /(^|[^a-z])(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|mailer-daemon)([^a-z]|$)/i;

/** Quick replies only make sense when a real person wrote last. Never spend a model call on bulk mail or on a thread the user already answered. */
export function quickRepliesEligible(category: Category, messages: MessageView[]): boolean {
  const newest = messages.at(-1);
  if (!newest || category !== "people" || newest.isFromMe) return false;
  if (newest.unsubscribe) return false;
  return !newest.from.some((a) => NO_REPLY.test(a.address.split("@")[0] ?? ""));
}

/** Changes whenever a new message lands, so cached chips never answer an older message. */
export function quickRepliesKey(threadId: number, messages: MessageView[]): string {
  const newest = messages.at(-1);
  return `${threadId}:${newest?.id ?? 0}:${newest?.date ?? 0}`;
}

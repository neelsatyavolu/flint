import type { ReceiptStatus, ReceiptSummary } from "../types";

export const FORWARD_GAP_MS = 60 * 60 * 1000;
export const PREFETCH_NOTE = "Apple Mail Privacy Protection loads images for every message, so opens can't be confirmed";
export const UNREGISTERED_NOTE = "Receipts unavailable for this message";

export type CountedOpen = { at: number; fingerprint: string | null; client: string | null };

/**
 * SPEC section 6: a counted open whose fingerprint and client both differ from the recipient's first
 * counted open, arriving more than an hour later, suggests the message was forwarded.
 */
export function isPossiblyForwarded(opens: readonly CountedOpen[]): boolean {
  if (opens.length < 2) return false;
  const sorted = [...opens].sort((a, b) => a.at - b.at);
  const first = sorted[0]!;
  return sorted.slice(1).some((e) => e.at - first.at > FORWARD_GAP_MS && e.fingerprint !== first.fingerprint && e.client !== first.client);
}

export type RecipientSignals = {
  openCount: number;
  repliedAt: number | null;
  sawPrefetch: boolean;
  /** Tracking never registered (service unreachable) or turned off. */
  registered: boolean;
};

/** replied > opened > unknowable > sent. 'untracked' only when nothing else is known and the message was not registered. */
export function recipientStatus(s: RecipientSignals): ReceiptStatus {
  if (s.repliedAt !== null) return "replied";
  if (s.openCount > 0) return "opened";
  if (!s.registered) return "untracked";
  if (s.sawPrefetch) return "unknowable";
  return "sent";
}

export function recipientNote(status: ReceiptStatus, registered: boolean): string | null {
  if (status === "unknowable") return PREFETCH_NOTE;
  if (status === "untracked" && !registered) return UNREGISTERED_NOTE;
  return null;
}

export function summarize(recipients: { status: ReceiptStatus; lastOpenAt: number | null }[]): ReceiptSummary {
  const opened = recipients.filter((r) => r.status === "opened" || r.status === "replied").length;
  const lastOpenAt = recipients.reduce<number | null>((m, r) => (r.lastOpenAt === null ? m : m === null ? r.lastOpenAt : Math.max(m, r.lastOpenAt)), null);
  let status: ReceiptStatus = "sent";
  if (recipients.some((r) => r.status === "replied")) status = "replied";
  else if (opened > 0) status = "opened";
  else if (recipients.length > 0 && recipients.every((r) => r.status === "untracked")) status = "untracked";
  else if (recipients.some((r) => r.status === "unknowable") && recipients.every((r) => r.status === "unknowable" || r.status === "untracked")) status = "unknowable";
  return { opened, total: recipients.length, status, lastOpenAt };
}

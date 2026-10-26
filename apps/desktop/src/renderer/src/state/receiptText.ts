import { format, isSameDay } from "date-fns";
import type { ReceiptDetail, ReceiptRecipient, ReceiptStatus, ReceiptSummary } from "@flint/core";

export type ReceiptTone = "ok" | "warn" | "muted";

/** Time inside a receipt line: "3:52 PM" today, "Oct 21, 3:52 PM" otherwise. */
export function receiptTime(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  return isSameDay(d, new Date(now)) ? format(d, "h:mm a") : format(d, "MMM d, h:mm a");
}

export function receiptTone(status: ReceiptStatus): ReceiptTone {
  switch (status) {
    case "opened":
    case "replied":
      return "ok";
    case "unknowable":
      return "warn";
    case "sent":
    case "untracked":
      return "muted";
    default:
      return assertNever(status);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled receipt status: ${String(value)}`);
}

type OpenEvent = ReceiptDetail["events"][number];

/** The first counted open for one recipient, used for the client and place in the status line. */
export function firstCountedOpen(detail: ReceiptDetail | null | undefined, email: string): OpenEvent | undefined {
  const target = email.toLowerCase();
  return detail?.events.filter((e) => e.counted && e.kind === "open" && e.email.toLowerCase() === target).sort((a, b) => a.at - b.at)[0];
}

/**
 * One status line per recipient. Only states the service can back up:
 * "Opened 3:52 PM · Gmail · San Jose", "Can't confirm opens: Apple Mail Privacy Protection",
 * "Replied", "No open detected".
 */
export function recipientStatusLine(r: ReceiptRecipient, detail?: ReceiptDetail | null, now: number = Date.now()): string {
  switch (r.status) {
    case "opened": {
      const ev = firstCountedOpen(detail, r.email);
      const parts = [r.firstOpenAt ? `Opened ${receiptTime(r.firstOpenAt, now)}` : "Opened"];
      if (ev?.client) parts.push(ev.client);
      if (ev?.location) parts.push(ev.location);
      if (r.possiblyForwarded) parts.push("may have been forwarded");
      return parts.join(" · ");
    }
    case "replied":
      return r.repliedAt ? `Replied ${receiptTime(r.repliedAt, now)}` : "Replied";
    case "unknowable":
      return "Can't confirm opens: Apple Mail Privacy Protection";
    case "sent":
      return "No open detected";
    case "untracked":
      return "Receipts unavailable for this message";
    default:
      return assertNever(r.status);
  }
}

export type ReceiptMarker = {
  /** "2/3" when there are several recipients, "" for one (the check says it all). */
  text: string;
  tone: ReceiptTone;
  /** At least one recipient opened or replied: a double check. */
  read: boolean;
  /** Spoken and hover label, e.g. "Opened by 2 of 3". */
  label: string;
};

/** The check mark on list rows and message cards: one grey check when sent, a green double check once read. */
export function receiptMarker(s: ReceiptSummary): ReceiptMarker {
  const read = s.opened > 0 || s.status === "replied";
  const several = s.total > 1;
  const text = several ? `${s.opened}/${s.total}` : "";
  if (read) return { text, read, tone: "ok", label: several ? `Opened by ${s.opened} of ${s.total}` : s.status === "replied" ? "Replied" : "Opened" };
  if (s.status === "unknowable") return { text, read, tone: "warn", label: "Can't confirm opens: Apple Mail Privacy Protection" };
  return { text, read, tone: "muted", label: several ? `Not opened yet by any of ${s.total}` : "Not opened yet" };
}

/** The same summary for one sent message, from its per-recipient detail. Untracked recipients (you, your aliases) don't count. */
export function summaryOf(detail: ReceiptDetail): ReceiptSummary {
  const tracked = detail.recipients.filter((r) => r.status !== "untracked");
  const opened = tracked.filter((r) => r.status === "opened" || r.status === "replied").length;
  const status: ReceiptStatus = tracked.some((r) => r.status === "replied") ? "replied" : opened > 0 ? "opened" : tracked.some((r) => r.status === "unknowable") ? "unknowable" : tracked.length ? "sent" : "untracked";
  const lastOpenAt = tracked.reduce<number | null>((m, r) => (r.lastOpenAt && (!m || r.lastOpenAt > m) ? r.lastOpenAt : m), null);
  return { opened, total: tracked.length, status, lastOpenAt };
}

const EVENT_LABELS: Record<OpenEvent["kind"], string> = {
  open: "Opened",
  prefetch: "Image prefetch",
  scanner: "Security scan",
  self: "You",
  bot: "Automated fetch",
  duplicate: "Repeat view",
};

export function eventLabel(kind: OpenEvent["kind"]): string {
  return EVENT_LABELS[kind];
}

/** Timeline row text: "Opened · Gmail · iPhone · San Jose" with a "not counted" tail for filtered events. */
export function eventLine(ev: OpenEvent): string {
  const parts = [eventLabel(ev.kind), ev.client, ev.device, ev.location].filter((p): p is string => Boolean(p));
  if (!ev.counted) parts.push("not counted");
  return parts.join(" · ");
}

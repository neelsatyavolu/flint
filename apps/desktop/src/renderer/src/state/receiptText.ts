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
 * "Replied", "Not opened yet".
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
      return "Not opened yet";
    case "untracked":
      return "Receipts unavailable for this message";
    default:
      return assertNever(r.status);
  }
}

/** "2/3" for the list marker. */
export function receiptMarker(s: ReceiptSummary): { text: string; tone: ReceiptTone } {
  const allOpened = s.total > 0 && s.opened >= s.total;
  return { text: `${s.opened}/${s.total}`, tone: allOpened ? "ok" : "muted" };
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

import { describe, expect, it } from "vitest";
import type { ReceiptDetail, ReceiptRecipient, ReceiptStatus } from "@flint/core";
import { eventLabel, eventLine, firstCountedOpen, receiptMarker, receiptTone, recipientStatusLine } from "./receiptText";

const NOW = new Date(2026, 9, 25, 18, 0).getTime();
const at = (h: number, m: number, day = 25) => new Date(2026, 9, day, h, m).getTime();

function recipient(status: ReceiptStatus, over: Partial<ReceiptRecipient> = {}): ReceiptRecipient {
  return { email: "c@x.test", name: "Carla", status, firstOpenAt: null, lastOpenAt: null, openCount: 0, repliedAt: null, note: null, possiblyForwarded: false, ...over };
}
const detail: ReceiptDetail = {
  trackedId: 1, sentAt: at(9, 0),
  recipients: [],
  events: [
    { at: at(16, 5), email: "c@x.test", kind: "prefetch", client: "Apple Mail", device: null, location: null, counted: false },
    { at: at(15, 52), email: "C@x.test", kind: "open", client: "Gmail", device: "iPhone", location: "San Jose", counted: true },
  ],
};

describe("receipt status text", () => {
  it("covers every status", () => {
    const statuses: ReceiptStatus[] = ["sent", "opened", "replied", "unknowable", "untracked"];
    const lines = statuses.map((s) => recipientStatusLine(recipient(s), detail, NOW));
    expect(new Set(lines).size).toBe(statuses.length);
    expect(statuses.map(receiptTone)).toEqual(["muted", "ok", "ok", "warn", "muted"]);
  });

  it("opened shows time, client and place", () => {
    const r = recipient("opened", { firstOpenAt: at(15, 52) });
    expect(recipientStatusLine(r, detail, NOW)).toBe("Opened 3:52 PM · Gmail · San Jose");
  });

  it("opened on an earlier day names the day and flags forwards", () => {
    const r = recipient("opened", { firstOpenAt: at(15, 52, 22), possiblyForwarded: true });
    expect(recipientStatusLine(r, null, NOW)).toBe("Opened Oct 22, 3:52 PM · may have been forwarded");
  });

  it("opened without a time", () => {
    expect(recipientStatusLine(recipient("opened"), null, NOW)).toBe("Opened");
  });

  it("states the other cases plainly", () => {
    expect(recipientStatusLine(recipient("unknowable"), null, NOW)).toBe("Can't confirm opens: Apple Mail Privacy Protection");
    expect(recipientStatusLine(recipient("sent"), null, NOW)).toBe("Not opened yet");
    expect(recipientStatusLine(recipient("replied"), null, NOW)).toBe("Replied");
    expect(recipientStatusLine(recipient("replied", { repliedAt: at(10, 4) }), null, NOW)).toBe("Replied 10:04 AM");
    expect(recipientStatusLine(recipient("untracked"), null, NOW)).toBe("Receipts unavailable for this message");
  });

  it("finds the first counted open case-insensitively", () => {
    expect(firstCountedOpen(detail, "c@x.test")?.client).toBe("Gmail");
    expect(firstCountedOpen(null, "c@x.test")).toBeUndefined();
  });

  it("builds the list marker", () => {
    expect(receiptMarker({ opened: 2, total: 3, status: "opened", lastOpenAt: null })).toEqual({ text: "2/3", tone: "muted" });
    expect(receiptMarker({ opened: 3, total: 3, status: "opened", lastOpenAt: null })).toEqual({ text: "3/3", tone: "ok" });
    expect(receiptMarker({ opened: 0, total: 0, status: "sent", lastOpenAt: null }).tone).toBe("muted");
  });

  it("describes events and marks uncounted ones", () => {
    expect(eventLine(detail.events[1]!)).toBe("Opened · Gmail · iPhone · San Jose");
    expect(eventLine(detail.events[0]!)).toBe("Image prefetch · Apple Mail · not counted");
    for (const k of ["open", "prefetch", "scanner", "self", "bot", "duplicate"] as const) expect(eventLabel(k)).toBeTruthy();
  });
});

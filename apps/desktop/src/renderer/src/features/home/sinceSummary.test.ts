import { describe, expect, it } from "vitest";
import type { Bundle, ThreadListItem, ThreadPage } from "@flint/core";
import { sinceLabel, sinceParts, sinceStart } from "./sinceSummary";

const NOW = new Date(2026, 9, 25, 17, 0).getTime();
const SINCE = new Date(2026, 9, 25, 14, 0).getTime();
const MIN = 60_000;

const thread = (id: number, lastDate: number, senders: string[], category: ThreadListItem["category"] = "people"): ThreadListItem => ({
  id, accountId: "a1", subject: `s${id}`, snippet: "", participants: senders.map((n) => ({ name: n, address: `${n.toLowerCase().replace(/\s/g, ".")}@x.org` })),
  lastDate, messageCount: 1, unreadCount: 1, hasAttachments: false, pinned: false, muted: false, snoozedUntil: null, category, hasDraft: false, receipt: null,
});
const bundle = (category: Bundle["category"], unreadCount: number, lastDate: number): Bundle => ({ category, unreadCount, totalCount: unreadCount + 2, lastDate, latest: [] });
const page = (items: ThreadListItem[], bundles: Bundle[] = []): ThreadPage => ({ items, bundles, nextCursor: null });

describe("sinceParts", () => {
  it("names the newest two senders and counts the rest", () => {
    const p = page([
      thread(1, SINCE + 10 * MIN, ["Omar Haddad"]),
      thread(2, SINCE + 30 * MIN, ["me", "Maria Lopez"]),
      thread(3, SINCE + 5 * MIN, ["Dan"]),
      thread(4, SINCE + 1 * MIN, ["Ann"]),
      thread(5, SINCE - MIN, ["Old Sender"]),
    ]);
    expect(sinceParts(p, SINCE)).toEqual([{ key: "people", text: "Maria, Omar and 2 others wrote", target: { view: "inbox" } }]);
  });

  it("handles one and two senders, skipping my own last messages", () => {
    expect(sinceParts(page([thread(1, SINCE + MIN, ["Maria"])]), SINCE)[0]?.text).toBe("Maria wrote");
    expect(sinceParts(page([thread(1, SINCE + 2 * MIN, ["Maria"]), thread(2, SINCE + MIN, ["Omar", "me"])]), SINCE)[0]?.text).toBe("Maria and Omar wrote");
    expect(sinceParts(page([thread(1, SINCE + MIN, ["me"])]), SINCE)).toEqual([]);
  });

  it("adds unread bundles that changed since, linking to each bundle", () => {
    const p = page([], [bundle("notifications", 4, SINCE + MIN), bundle("newsletters", 1, SINCE + MIN), bundle("notifications", 3, SINCE - MIN)]);
    expect(sinceParts(p, SINCE)).toEqual([
      { key: "notifications", text: "4 unread notifications", target: { view: "inbox", category: "notifications" } },
      { key: "newsletters", text: "1 unread newsletter", target: { view: "inbox", category: "newsletters" } },
    ]);
    expect(sinceParts(page([], [bundle("newsletters", 0, SINCE + MIN)]), SINCE)).toEqual([]);
  });
});

describe("sinceStart and sinceLabel", () => {
  it("falls back to the start of today", () => {
    expect(sinceStart(SINCE, NOW)).toBe(SINCE);
    expect(sinceStart(0, NOW)).toBe(new Date(2026, 9, 25).getTime());
    expect(sinceStart(NOW + MIN, NOW)).toBe(new Date(2026, 9, 25).getTime());
  });

  it("labels today, yesterday and older visits", () => {
    expect(sinceLabel(SINCE, NOW)).toBe("2:00 PM");
    expect(sinceLabel(new Date(2026, 9, 24, 17, 5).getTime(), NOW)).toBe("yesterday 5:05 PM");
    expect(sinceLabel(new Date(2026, 9, 19, 9, 0).getTime(), NOW)).toBe("Mon 9:00 AM");
  });
});

import { describe, expect, it } from "vitest";
import { parsed } from "./fixtures";
import type { ParsedInvite, StoredInvite } from "./contracts";
import { effectiveTimes, mergeInvite } from "./merge";
import { nextOccurrence } from "./recurrence";

const DAY = 86_400_000;
const account = { provider: "imap", authKind: "password", calendarScope: false } as const;

/** A weekly all-day series starting Tue 2026-10-06 (one day long). */
const allDayWeekly = (over: Partial<ParsedInvite> = {}): ParsedInvite => ({
  ...parsed("google-weekly-meet.ics"), allDay: true, timeZone: null, start: Date.UTC(2026, 9, 6), end: Date.UTC(2026, 9, 7),
  startDate: "2026-10-06", endDate: "2026-10-07", recurrence: { summary: "Weekly on Tuesday", rrule: "FREQ=WEEKLY;BYDAY=TU", hasExceptions: false },
  recurrenceId: null, ...over,
});

const merge = (invite: ParsedInvite, now: number, zone: string) => {
  const stored: StoredInvite = { messageId: 1, accountId: "a", invite, ics: "", parserVersion: 2, parsedAt: 0 };
  return mergeInvite({ stored, versions: [stored], response: null }, { now, ownAddresses: ["me@example.com"], account, zone });
};

describe("all-day series", () => {
  it("shows the next occurrence on its own date for a viewer east of UTC", () => {
    // Mon 2026-10-26 12:00 in Berlin; next Tuesday is 2026-10-27, not the 26th.
    const now = Date.UTC(2026, 9, 26, 11);
    const { times } = effectiveTimes(allDayWeekly(), now, "Europe/Berlin");
    expect(times).toMatchObject({ startDate: "2026-10-27", endDate: "2026-10-28", start: Date.UTC(2026, 9, 27) });
  });

  it("skips an EXDATE and uses an RDATE", () => {
    const now = Date.UTC(2026, 9, 26, 11);
    const skipped = allDayWeekly({ recurrence: { summary: "x", rrule: "FREQ=WEEKLY;BYDAY=TU", hasExceptions: true, excluded: [Date.UTC(2026, 9, 27)] } });
    expect(effectiveTimes(skipped, now, "UTC").times.startDate).toBe("2026-11-03");
    const added = allDayWeekly({ recurrence: { summary: "x", rrule: "FREQ=WEEKLY;BYDAY=TU", hasExceptions: true, excluded: [Date.UTC(2026, 9, 27)], added: [Date.UTC(2026, 9, 29)] } });
    expect(effectiveTimes(added, now, "UTC").times.startDate).toBe("2026-10-29");
  });

  it("is not past at 5 PM on its last day in a zone west of UTC, and is the next morning", () => {
    const single = allDayWeekly({ recurrence: null });
    // Tue 2026-10-06 17:00 PDT is Wed 00:00 UTC
    expect(merge(single, Date.UTC(2026, 9, 7, 0, 30), "America/Los_Angeles").state).not.toBe("past");
    expect(merge(single, Date.UTC(2026, 9, 7, 7, 30), "America/Los_Angeles").state).toBe("past");
  });
});

describe("nextOccurrence", () => {
  const wall = { year: 2026, month: 10, day: 6, hour: 9, minute: 0, second: 0 };
  it("honours excluded and added instants", () => {
    const after = Date.UTC(2026, 9, 7);
    const second = nextOccurrence("FREQ=WEEKLY;BYDAY=TU", wall, "UTC", after)!;
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=TU", wall, "UTC", after, [second])).toBe(second + 7 * DAY);
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=TU", wall, "UTC", after, [], [after + DAY])).toBe(after + DAY);
  });
});

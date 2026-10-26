import { describe, expect, it } from "vitest";
import { nextOccurrence, seriesEnd, summarizeRecurrence } from "./recurrence";
import type { Wall } from "./zones";

const TUE: Wall = { year: 2026, month: 10, day: 27, hour: 15, minute: 0, second: 0 };
const sum = (rule: string, start: Wall = TUE, zone: string | null = "America/Los_Angeles"): string => summarizeRecurrence(rule, start, zone);

describe("summarizeRecurrence", () => {
  it.each([
    ["FREQ=DAILY", "Daily"],
    ["FREQ=DAILY;INTERVAL=3", "Every 3 days"],
    ["FREQ=WEEKLY", "Weekly on Tuesday"],
    ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "Every weekday"],
    ["FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA", "Daily"],
    ["FREQ=WEEKLY;BYDAY=TU,TH", "Weekly on Tuesday and Thursday"],
    ["FREQ=WEEKLY;BYDAY=MO,WE,FR", "Weekly on Monday, Wednesday and Friday"],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE", "Every 2 weeks on Monday and Wednesday"],
    ["FREQ=WEEKLY;BYDAY=SU,SA", "Weekly on Saturday and Sunday"],
    ["FREQ=MONTHLY;BYMONTHDAY=3", "Monthly on the 3rd"],
    ["FREQ=MONTHLY;BYMONTHDAY=22", "Monthly on the 22nd"],
    ["FREQ=MONTHLY;BYMONTHDAY=11", "Monthly on the 11th"],
    ["FREQ=MONTHLY;BYMONTHDAY=-1", "Monthly on the last day"],
    ["FREQ=MONTHLY;BYDAY=3FR", "Monthly on the third Friday"],
    ["FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1", "Monthly on the last Friday"],
    ["FREQ=MONTHLY", "Monthly on the 27th"],
    ["FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1", "Every 3 months on the 1st"],
    ["FREQ=YEARLY", "Yearly on Oct 27"],
    ["FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=9", "Yearly on Mar 9"],
    ["FREQ=YEARLY;BYMONTH=11;BYDAY=4TH", "Yearly on the fourth Thursday of November"],
    ["FREQ=WEEKLY;COUNT=10", "Weekly on Tuesday, 10 times"],
    ["FREQ=DAILY;COUNT=1", "Daily, once"],
    ["FREQ=WEEKLY;BYDAY=TU;UNTIL=20261212", "Weekly on Tuesday until Dec 12"],
    ["FREQ=WEEKLY;BYDAY=TU;UNTIL=20270105T235959Z", "Weekly on Tuesday until Jan 5, 2027"],
    ["RRULE:FREQ=DAILY", "Daily"],
  ])("%s", (rule, expected) => { expect(sum(rule)).toBe(expected); });

  it("moves a UTC UNTIL into the event's zone", () => {
    expect(sum("FREQ=WEEKLY;UNTIL=20261213T075959Z")).toBe("Weekly on Tuesday until Dec 12");
    expect(sum("FREQ=WEEKLY;UNTIL=20261213T075959Z", TUE, "UTC")).toBe("Weekly on Tuesday until Dec 13");
  });
  it("is never empty", () => {
    expect(sum("nonsense")).toBe("Repeats");
  });
});

describe("nextOccurrence", () => {
  const la = "America/Los_Angeles";
  it("returns the first occurrence when it is still ahead", () => {
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=TU", TUE, la, Date.UTC(2026, 9, 1))).toBe(Date.UTC(2026, 9, 27, 22));
  });
  it("skips to the next weekly occurrence and keeps the wall time across a DST change", () => {
    const next = nextOccurrence("FREQ=WEEKLY;BYDAY=TU", TUE, la, Date.UTC(2026, 10, 2));
    expect(next).toBe(Date.UTC(2026, 10, 3, 23));
  });
  it("returns null once a COUNT series is over", () => {
    expect(nextOccurrence("FREQ=WEEKLY;COUNT=2", TUE, la, Date.UTC(2027, 0, 1))).toBeNull();
  });
});

describe("seriesEnd", () => {
  const la = "America/Los_Angeles";
  it("is null for an endless series", () => {
    expect(seriesEnd("FREQ=WEEKLY", TUE, la, 3_600_000)).toBeNull();
  });
  it("uses UNTIL, or the last COUNT occurrence", () => {
    expect(seriesEnd("FREQ=WEEKLY;UNTIL=20261213T075959Z", TUE, la, 0)).toBe(Date.UTC(2026, 11, 13, 7, 59, 59));
    expect(seriesEnd("FREQ=WEEKLY;COUNT=3", TUE, la, 3_600_000)).toBe(Date.UTC(2026, 10, 10, 23) + 3_600_000);
  });
});

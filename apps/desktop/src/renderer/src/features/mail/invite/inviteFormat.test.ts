import { describe, expect, it } from "vitest";
import { chipText, chipWhen, durationText, localZoneAbbr, organizerZoneText, whenText } from "./inviteFormat";

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const base = { allDay: false, startDate: null, endDate: null };

describe("inviteFormat", () => {
  it("formats a same-day range, dropping the shared AM/PM", () => {
    const t = whenText({ ...base, start: local(2026, 10, 27, 15), end: local(2026, 10, 27, 15, 45) });
    expect(t).toMatch(/Oct 27 · 3 to 3:45 PM$/);
  });
  it("formats all-day single and multi-day events from the date strings", () => {
    expect(whenText({ start: 0, end: 0, allDay: true, startDate: "2026-10-27", endDate: "2026-10-28" })).toMatch(/Oct 27, all day$/);
    expect(whenText({ start: 0, end: 0, allDay: true, startDate: "2026-10-27", endDate: "2026-10-30" })).toMatch(/Oct 27 to .*Oct 29$/);
  });
  it("durations", () => {
    expect(durationText({ ...base, start: 0, end: 45 * 60_000 })).toBe("45 min");
    expect(durationText({ ...base, start: 0, end: 90 * 60_000 })).toBe("1 hr 30 min");
    expect(durationText({ ...base, start: 0, end: 120 * 60_000 })).toBe("2 hrs");
    expect(durationText({ start: 0, end: 0, allDay: true, startDate: "2026-10-27", endDate: "2026-10-30" })).toBe("3 days");
    expect(durationText({ start: 0, end: 0, allDay: true, startDate: "2026-10-27", endDate: "2026-10-28" })).toBeNull();
  });
  it("shows the organizer's zone only when it differs", () => {
    const start = Date.UTC(2026, 9, 27, 19);
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(organizerZoneText({ allDay: false, start, end: start + 3_600_000, timeZone: here })).toBeNull();
    expect(organizerZoneText({ allDay: true, start, end: start, timeZone: "Asia/Tokyo" })).toBeNull();
    const far = here === "Asia/Tokyo" ? "America/New_York" : "Asia/Tokyo";
    expect(organizerZoneText({ allDay: false, start, end: start + 3_600_000, timeZone: far })).toMatch(/for the organizer$/);
  });
  it("chip text", () => {
    const now = local(2026, 10, 25, 12);
    const chip = { uid: "u", method: "REQUEST", title: "T", start: local(2026, 10, 27, 15), end: local(2026, 10, 27, 16), allDay: false, startDate: null, state: "new", yourResponse: "needs-action", organizerName: null, messageId: 1 } as const;
    expect(chipText(chip, now)).toMatch(/^Invite · Tue 3 PM$/);
    expect(chipText({ ...chip, state: "cancelled" }, now)).toMatch(/^Cancelled/);
    expect(chipText({ ...chip, state: "reply" }, now)).toBe("Reply");
    expect(chipWhen({ ...chip, start: local(2026, 11, 20, 9) }, now)).toBe("Nov 20, 9 AM");
  });
  it("adds the year only when the event is not in the current year", () => {
    const now = local(2026, 10, 25, 12);
    expect(whenText({ ...base, start: local(2027, 1, 5, 9), end: local(2027, 1, 5, 10) }, now)).toMatch(/Jan 5, 2027 · 9 to 10 AM$/);
    expect(whenText({ ...base, start: local(2026, 10, 27, 9), end: local(2026, 10, 27, 10) }, now)).not.toMatch(/2026/);
    expect(whenText({ start: 0, end: 0, allDay: true, startDate: "2027-01-05", endDate: "2027-01-06" }, now)).toMatch(/Jan 5, 2027, all day$/);
    const chip = { start: local(2027, 1, 20, 9), allDay: false, startDate: null } as const;
    expect(chipWhen(chip, now)).toBe("Jan 20, 2027, 9 AM");
  });
  it("names the viewer's own zone", () => {
    expect(localZoneAbbr(Date.UTC(2026, 9, 27, 19))).not.toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { resolveZone, wallIn, wallToEpoch } from "./zones";

describe("resolveZone", () => {
  it.each([
    ["Pacific Standard Time", "America/Los_Angeles"], ["pacific standard time", "America/Los_Angeles"], ["Eastern Standard Time", "America/New_York"],
    ["Central Europe Standard Time", "Europe/Budapest"], ["India Standard Time", "Asia/Calcutta"], ["W. Europe Standard Time", "Europe/Berlin"],
    ["Tokyo Standard Time", "Asia/Tokyo"], ["America/Chicago", "America/Chicago"], ["Europe/London", "Europe/London"], ["UTC", "UTC"], ["GMT", "UTC"],
    ["/mozilla.org/20050126_1/America/Denver", "America/Denver"], ["/softwarestudio.org/Tzfile/America/Argentina/Buenos_Aires", "America/Argentina/Buenos_Aires"],
    ["(UTC-08:00) Pacific Time (US & Canada)", "America/Los_Angeles"], ["\"America/New_York\"", "America/New_York"],
    ["Customized Time Zone", null], ["", null], [undefined, null], ["Mars/Olympus", null],
  ])("%s", (tzid, expected) => { expect(resolveZone(tzid as string | undefined)).toBe(expected); });
});

describe("wallToEpoch", () => {
  const w = (year: number, month: number, day: number, hour: number, minute = 0) => ({ year, month, day, hour, minute, second: 0 });
  it("converts summer and winter time", () => {
    expect(wallToEpoch(w(2026, 7, 1, 12), "America/New_York")).toBe(Date.UTC(2026, 6, 1, 16));
    expect(wallToEpoch(w(2026, 12, 1, 12), "America/New_York")).toBe(Date.UTC(2026, 11, 1, 17));
    expect(wallToEpoch(w(2026, 11, 9, 20), "Asia/Calcutta")).toBe(Date.UTC(2026, 10, 9, 14, 30));
  });
  it("moves forward through a spring-forward gap", () => {
    // 2026-03-08 02:30 does not exist in New York; calendars show it as 03:30 EDT.
    expect(wallToEpoch(w(2026, 3, 8, 2, 30), "America/New_York")).toBe(Date.UTC(2026, 2, 8, 7, 30));
  });
  it("takes the first instant of a fall-back overlap", () => {
    // 2026-11-01 01:30 happens twice in New York; the first is EDT (05:30Z).
    expect(wallToEpoch(w(2026, 11, 1, 1, 30), "America/New_York")).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });
  it("round-trips with wallIn", () => {
    const epoch = Date.UTC(2026, 9, 27, 22);
    expect(wallIn(epoch, "America/Los_Angeles")).toEqual(w(2026, 10, 27, 15));
  });
});

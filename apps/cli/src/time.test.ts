import { describe, expect, it } from "vitest";
import { formatFull, formatShort, parseFuture, parseWhen } from "./time";
import { NOW } from "./test-util";

const at = (y: number, mo: number, d: number, h = 8, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe("parseWhen", () => {
  it("handles relative offsets", () => {
    expect(parseWhen("30m", NOW)).toBe(NOW.getTime() + 30 * 60_000);
    expect(parseWhen("2h", NOW)).toBe(NOW.getTime() + 2 * 3_600_000);
    expect(parseWhen("in 3 days", NOW)).toBe(NOW.getTime() + 3 * 86_400_000);
    expect(parseWhen("1w", NOW)).toBe(NOW.getTime() + 7 * 86_400_000);
  });
  it("handles tomorrow, today and weekdays", () => {
    expect(parseWhen("tomorrow", NOW)).toBe(at(2026, 10, 26));
    expect(parseWhen("tomorrow 3pm", NOW)).toBe(at(2026, 10, 26, 15));
    expect(parseWhen("today 5:30pm", NOW)).toBe(at(2026, 10, 25, 17, 30));
    expect(parseWhen("monday", NOW)).toBe(at(2026, 10, 26));
    expect(parseWhen("Sunday", NOW)).toBe(at(2026, 11, 1));
    expect(parseWhen("fri 14:00", NOW)).toBe(at(2026, 10, 30, 14));
  });
  it("handles ISO dates and times", () => {
    expect(parseWhen("2026-10-26", NOW)).toBe(at(2026, 10, 26));
    expect(parseWhen("2026-10-26 09:00", NOW)).toBe(at(2026, 10, 26, 9));
    expect(parseWhen("2026-10-26T09:15", NOW)).toBe(at(2026, 10, 26, 9, 15));
    expect(parseWhen("2026-10-26T09:00:00Z", NOW)).toBe(Date.UTC(2026, 9, 26, 9));
    expect(parseWhen("12am tomorrow".split(" ").reverse().join(" "), NOW)).toBe(at(2026, 10, 26, 0));
  });
  it("rejects nonsense", () => {
    for (const bad of ["", "soon", "0h", "2026-02-31", "tomorrow 25:00", "tomorrow 9", "tomorrow 13pm", "xyz 9:00"]) {
      expect(() => parseWhen(bad, NOW), bad).toThrow(/Couldn't read/);
    }
  });
  it("parseFuture rejects the past", () => {
    expect(() => parseFuture("2026-10-24", NOW)).toThrow(/in the past/);
    expect(parseFuture("1h", NOW)).toBeGreaterThan(NOW.getTime());
  });
});

describe("format", () => {
  it("formats times", () => {
    expect(formatFull(at(2026, 10, 26, 9, 5))).toBe("2026-10-26 09:05");
    expect(formatShort(at(2026, 10, 25, 7, 30), NOW)).toBe("07:30");
    expect(formatShort(at(2026, 10, 3), NOW)).toBe("Oct 3");
    expect(formatShort(at(2025, 3, 2), NOW)).toBe("2025-03-02");
  });
});

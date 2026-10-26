import { describe, expect, it } from "vitest";
import { dateGroupLabel, displayName, formatAddress, formatAgo, formatFileSize, formatFullDate, formatListTime, formatParticipants, formatRecipients, pluralize } from "./format";

// Sunday, Oct 25 2026, 4:00 PM local time.
const NOW = new Date(2026, 9, 25, 16, 0).getTime();
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe("formatListTime", () => {
  it("shows the clock time today", () => expect(formatListTime(at(2026, 10, 25, 15, 49), NOW)).toBe("3:49 PM"));
  it("shows the weekday within the week", () => expect(formatListTime(at(2026, 10, 23), NOW)).toBe("Fri"));
  it("shows yesterday as a weekday", () => expect(formatListTime(at(2026, 10, 24), NOW)).toBe("Sat"));
  it("shows month and day after a week", () => expect(formatListTime(at(2026, 10, 18), NOW)).toBe("Oct 18"));
  it("adds the year for earlier years", () => expect(formatListTime(at(2025, 10, 23), NOW)).toBe("Oct 23, 2025"));
});

describe("formatAgo", () => {
  it.each([
    [NOW - 30_000, "just now"],
    [NOW + 30_000, "just now"],
    [at(2026, 10, 25, 15, 48), "12 min ago"],
    [at(2026, 10, 25, 14, 0), "2h ago"],
    [at(2026, 10, 25, 0, 30), "15h ago"],
    [at(2026, 10, 24, 20, 0), "yesterday"],
    [at(2026, 10, 22, 9, 0), "3 days ago"],
    [at(2026, 10, 12), "Oct 12"],
    [at(2025, 12, 31), "Dec 31, 2025"],
  ])("formats %i as %s", (ts, text) => expect(formatAgo(ts, NOW)).toBe(text));

  it("counts hours across midnight for a recent time", () => {
    expect(formatAgo(at(2026, 10, 24, 23, 0), at(2026, 10, 25, 1, 30))).toBe("2h ago");
  });
});

describe("dateGroupLabel", () => {
  it.each([
    [at(2026, 10, 25, 9), "TODAY"],
    [at(2026, 10, 24, 23), "YESTERDAY"],
    [at(2026, 10, 21), "THIS WEEK"],
    [at(2026, 10, 15), "LAST WEEK"],
    [at(2026, 9, 30), "SEPTEMBER"],
    [at(2025, 12, 2), "2025"],
  ])("labels %#", (ts, label) => expect(dateGroupLabel(ts, NOW)).toBe(label));
});

describe("formatFileSize", () => {
  it.each([[0, "0 B"], [512, "512 B"], [1536, "1.5 KB"], [2_410_552, "2.3 MB"], [1024, "1 KB"], [15 * 1024 * 1024, "15 MB"], [-1, "0 B"]])("%d -> %s", (n, s) => expect(formatFileSize(n)).toBe(s));
});

describe("addresses", () => {
  const carla = { name: "Carla Mendes", address: "carla@x.io" };
  const rodney = { name: "Rodney Okafor", address: "rodney@x.io" };
  it("falls back to the local part", () => expect(displayName({ name: "", address: "sam@x.io" })).toBe("sam"));
  it("shows the full name for one participant", () => expect(formatParticipants([carla])).toBe("Carla Mendes"));
  it("shows first names for several", () => expect(formatParticipants([carla, rodney])).toBe("Carla, Rodney"));
  it("dedupes by address and adds +N", () => {
    const more = ["a", "b", "c"].map((n) => ({ name: `${n} Person`, address: `${n}@x.io` }));
    expect(formatParticipants([carla, carla, rodney, ...more])).toBe("Carla, Rodney, a +2");
  });
  it("handles an empty list", () => expect(formatParticipants([])).toBe(""));
  it("formats name and address", () => {
    expect(formatAddress(carla)).toBe("Carla Mendes <carla@x.io>");
    expect(formatAddress({ name: " ", address: "a@b.c" })).toBe("a@b.c");
  });
  it("writes recipients with me", () => {
    expect(formatRecipients([{ name: "Alex Rivera", address: "alex@x.io" }, carla], ["ALEX@x.io"])).toBe("to me, Carla");
    expect(formatRecipients([])).toBe("");
  });
});

describe("misc", () => {
  it("pluralizes", () => {
    expect(pluralize(1, "message")).toBe("1 message");
    expect(pluralize(3, "message")).toBe("3 messages");
  });
  it("formats the full date", () => expect(formatFullDate(at(2026, 10, 23, 15, 49))).toBe("Oct 23, 2026, 3:49 PM"));
});

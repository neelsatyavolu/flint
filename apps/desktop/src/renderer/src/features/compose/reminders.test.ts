import { describe, expect, it } from "vitest";
import { reminderPresets } from "./reminders";

describe("reminderPresets", () => {
  it("offers 1 day, 3 days and 1 week from now", () => {
    const presets = reminderPresets(1_000);
    expect(presets.map((p) => p.label)).toEqual(["1 day", "3 days", "1 week"]);
    expect(presets.map((p) => (p.at - 1_000) / 86_400_000)).toEqual([1, 3, 7]);
  });
});

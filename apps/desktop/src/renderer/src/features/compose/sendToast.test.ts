import { describe, expect, it } from "vitest";
import { describeSend } from "./sendToast";

const base = { scheduledId: 1, sendAt: 0, status: "pending" as const };

describe("describeSend", () => {
  it("counts down the undo window", () => {
    const t = describeSend({ ...base, undoUntil: 20_000 }, 10_000);
    expect(t).toEqual({ message: "Sending in 10s", undoable: true, timeoutMs: 10_000 });
  });
  it("says Sent when undo is off", () => {
    expect(describeSend({ ...base, undoUntil: 5 }, 10)).toMatchObject({ message: "Sent", undoable: false });
  });
  it("names the time for send later", () => {
    const at = new Date(2026, 9, 25, 15, 0).getTime();
    const now = new Date(2026, 9, 25, 9, 0).getTime();
    expect(describeSend({ ...base, undoUntil: now }, now, at).message).toBe("Scheduled for 3:00 PM");
  });
});

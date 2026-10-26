import { describe, expect, it } from "vitest";
import { describeSend, isUndoSendKey, undoSendLabel } from "./sendToast";

const base = { scheduledId: 1, sendAt: 0, status: "pending" as const };

describe("describeSend", () => {
  it("counts down the undo window", () => {
    const t = describeSend({ ...base, undoUntil: 20_000 }, 10_000);
    expect(t).toEqual({ message: "Sending in 10s", undoable: true, timeoutMs: 10_000, until: 20_000 });
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

describe("undo send shortcut", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
  it("takes Cmd+Z and Cmd+Shift+Z on macOS", () => {
    expect(isUndoSendKey(key({ key: "z", metaKey: true }), true)).toBe(true);
    expect(isUndoSendKey(key({ key: "Z", metaKey: true, shiftKey: true }), true)).toBe(true);
  });
  it("takes Ctrl+Z elsewhere", () => {
    expect(isUndoSendKey(key({ key: "z", ctrlKey: true }), false)).toBe(true);
    expect(isUndoSendKey(key({ key: "z", ctrlKey: true }), true)).toBe(false);
  });
  it("ignores plain z and other modifier combinations", () => {
    expect(isUndoSendKey(key({ key: "z" }), true)).toBe(false);
    expect(isUndoSendKey(key({ key: "y", metaKey: true }), true)).toBe(false);
    expect(isUndoSendKey(key({ key: "z", metaKey: true, altKey: true }), true)).toBe(false);
  });
  it("names the shortcut in the toast", () => {
    expect(undoSendLabel(true)).toBe("Undo ⌘Z");
    expect(undoSendLabel(false)).toBe("Undo Ctrl+Z");
  });
});

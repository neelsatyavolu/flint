import { describe, expect, it } from "vitest";
import type { ScheduledSend, ThreadListItem } from "@flint/core";
import { todayRows } from "./todayRows";

const at = (d: number, h: number, min = 0) => new Date(2026, 9, d, h, min).getTime();
const NOW = at(25, 10);

function thread(id: number, snoozedUntil: number | null, subject = `Thread ${id}`): ThreadListItem {
  return {
    id, accountId: "a1", subject, snippet: "", participants: [], lastDate: NOW, messageCount: 1, unreadCount: 0, hasAttachments: false,
    pinned: false, muted: false, snoozedUntil, category: "people", hasDraft: false, receipt: null,
  };
}

function send(id: number, sendAt: number, status: ScheduledSend["status"] = "pending"): ScheduledSend {
  return { id, draftId: id, subject: `Send ${id}`, to: [{ name: "Carla Ruiz", address: "carla@example.com" }], sendAt, status, error: null, requestedBy: "user" };
}

describe("todayRows", () => {
  it("lists returns and sends due today in time order", () => {
    const rows = todayRows([thread(1, at(25, 15)), thread(2, at(25, 11, 30))], [send(9, at(25, 17, 30))], NOW);
    expect(rows.map((r) => r.key)).toEqual(["t2", "t1", "s9"]);
    expect(rows[2]).toMatchObject({ kind: "sends", subject: "Send 9", to: "Carla Ruiz" });
  });

  it("leaves out tomorrow, approval-held and finished sends", () => {
    const rows = todayRows(
      [thread(1, at(26, 8)), thread(2, null)],
      [send(1, at(26, 9)), send(2, at(25, 12), "awaiting_approval"), send(3, at(25, 12), "failed"), send(4, at(25, 23, 59))],
      NOW,
    );
    expect(rows.map((r) => r.key)).toEqual(["s4"]);
  });

  it("is empty with nothing due", () => expect(todayRows([], [], NOW)).toEqual([]));
});

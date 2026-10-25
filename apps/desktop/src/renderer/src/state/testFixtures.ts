import type { Bundle, ThreadListItem } from "@flint/core";

export function item(id: number, over: Partial<ThreadListItem> = {}): ThreadListItem {
  return {
    id, accountId: "a1", subject: `Subject ${id}`, snippet: "snippet", participants: [{ name: "Carla Mendes", address: "carla@x.test" }],
    lastDate: Date.UTC(2026, 9, 25, 12) - id * 3_600_000, messageCount: 1, unreadCount: 0, hasAttachments: false, pinned: false, muted: false,
    snoozedUntil: null, category: "people", hasDraft: false, receipt: null, ...over,
  };
}

export function bundle(category: Bundle["category"], lastDate: number, unreadCount = 1): Bundle {
  return { category, unreadCount, totalCount: 3, lastDate, latest: [{ from: { name: "News", address: "n@x.test" }, subject: "Hi" }] };
}

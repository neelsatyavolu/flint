import { describe, expect, it } from "vitest";
import { hasRemoteImages, initialExpanded, splitQuoted, wordCount } from "./quotedText";
import { activeLabelIndex, rowOffsets } from "./stickyLabel";
import { rowAvatar, rowSender, rowTime } from "./rowText";
import { rowMenuItems } from "./rowMenu";
import { item } from "../../state/testFixtures";
import { greeting } from "../home/greeting";
import { filterItems } from "../palette/filter";
import { groupActivity, scheduledIdOf, statusLabel } from "../agents/activityModel";
import { dateGroupLabel } from "../../lib/format";
import type { AgentActivity } from "@flint/core";

describe("splitQuoted", () => {
  it("splits an attributed quote", () => {
    const t = "Sounds good.\n\nOn Mon, Oct 5, 2026, Carla wrote:\n> Can we meet?\n> Thursday?";
    expect(splitQuoted(t)).toEqual({ body: "Sounds good.", quoted: "On Mon, Oct 5, 2026, Carla wrote:\n> Can we meet?\n> Thursday?" });
  });
  it("splits bare > lines", () => {
    expect(splitQuoted("Yes\n> old").quoted).toBe("> old");
  });
  it("leaves unquoted or fully quoted text alone", () => {
    expect(splitQuoted("Hello there").quoted).toBe("");
    expect(splitQuoted("> only quote").quoted).toBe("");
    expect(splitQuoted("On Monday we wrote: things").quoted).toBe("");
  });
});

describe("message helpers", () => {
  it("counts words from text or stripped html", () => {
    expect(wordCount({ text: "a b  c", html: null })).toBe(3);
    expect(wordCount({ text: null, html: "<style>x{}</style><p>one two</p>" })).toBe(2);
    expect(wordCount({ text: null, html: null })).toBe(0);
  });
  it("detects remote images", () => {
    expect(hasRemoteImages('<img src="https://a.test/x.png">')).toBe(true);
    expect(hasRemoteImages('<img src="data:image/png;base64,AA">')).toBe(false);
    expect(hasRemoteImages(null)).toBe(false);
  });
  it("expands the last and the newest unread message", () => {
    const m = [{ id: 1, seen: true }, { id: 2, seen: false }, { id: 3, seen: true }, { id: 4, seen: false }, { id: 5, seen: true }];
    expect([...initialExpanded(m)].sort()).toEqual([4, 5]);
    expect(initialExpanded([]).size).toBe(0);
  });
});

describe("sticky label", () => {
  it("finds the label at or above the scroll offset", () => {
    const heights = [28, 76, 76, 28, 76];
    const offsets = rowOffsets(heights);
    expect(offsets).toEqual([0, 28, 104, 180, 208]);
    expect(activeLabelIndex([0, 3], offsets, 0)).toBe(0);
    expect(activeLabelIndex([0, 3], offsets, 179)).toBe(0);
    expect(activeLabelIndex([0, 3], offsets, 180)).toBe(3);
    expect(activeLabelIndex([], offsets, 50)).toBe(-1);
    expect(activeLabelIndex([3], offsets, 10)).toBe(-1);
  });
});

describe("row text", () => {
  const me = { name: "me", address: "a@x.test" };
  const carla = { name: "Carla Mendes", address: "carla@x.test" };
  it("sender line and avatar", () => {
    expect(rowSender(item(1, { participants: [carla, { name: "Rodney Okafor", address: "r@x.test" }, me] })).text).toBe("Carla, Rodney, me");
    expect(rowSender(item(1, { hasDraft: true, participants: [me, carla] }))).toEqual({ draft: true, text: "Carla Mendes" });
    expect(rowAvatar(item(1, { participants: [me, carla] })).address).toBe("carla@x.test");
    expect(rowAvatar(item(1, { participants: [] })).name).toBe("me");
  });
  it("shows the wake time for snoozed mail", () => {
    const now = new Date(2026, 9, 25, 9).getTime();
    expect(rowTime(item(1, { snoozedUntil: now + 3_600_000 }), now).snoozed).toBe(true);
    expect(rowTime(item(1, { lastDate: now - 1000 }), now).snoozed).toBe(false);
  });
});

describe("rowMenuItems", () => {
  const calls: string[] = [];
  const h = {
    run: (a: { type: string }) => calls.push(a.type),
    snooze: () => calls.push("snooze"), move: () => calls.push("move"), reply: () => calls.push("reply"), block: () => calls.push("block"),
  };
  it("offers reply actions for one thread and omits them for many", () => {
    const one = rowMenuItems(item(1), [1], h, true).map((i) => ("label" in i ? i.label : "-"));
    expect(one).toContain("Reply");
    expect(one).toContain("Archive");
    expect(one).toContain("Block sender");
    const many = rowMenuItems(item(1), [1, 2], h, false).map((i) => ("label" in i ? i.label : "-"));
    expect(many).not.toContain("Reply");
    expect(many).toContain("Move to Inbox (2)");
  });
  it("runs handlers", () => {
    for (const entry of rowMenuItems(item(1, { unreadCount: 1, pinned: true, muted: true }), [1], h, true)) if (!("type" in entry)) entry.onSelect();
    expect(calls).toEqual(expect.arrayContaining(["reply", "archive", "trash", "pin", "read", "snooze", "move", "mute", "spam", "block"]));
  });
});

describe("greeting", () => {
  it("follows the hour and the name", () => {
    expect(greeting(new Date(2026, 9, 25, 9).getTime(), "Alex")).toBe("Good morning, Alex");
    expect(greeting(new Date(2026, 9, 25, 14).getTime(), " ")).toBe("Good afternoon");
    expect(greeting(new Date(2026, 9, 25, 20).getTime(), "A")).toBe("Good evening, A");
    expect(greeting(new Date(2026, 9, 25, 2).getTime(), "A")).toBe("Good evening, A");
  });
});

describe("filterItems", () => {
  const items = [{ id: "1", label: "Archive" }, { id: "2", label: "Move to folder", keywords: "label" }, { id: "3", label: "Snooze" }, { id: "4", label: "Mark as spam" }];
  it("matches every word and ranks prefixes first", () => {
    expect(filterItems(items, "").length).toBe(4);
    expect(filterItems(items, "sno").map((i) => i.id)).toEqual(["3"]);
    expect(filterItems(items, "label").map((i) => i.id)).toEqual(["2"]);
    expect(filterItems(items, "m").map((i) => i.id)).toEqual(["4", "2"]);
    expect(filterItems(items, "zzz")).toEqual([]);
    expect(filterItems(items, "a s")[0]?.id).toBe("4");
  });
});

describe("activityModel", () => {
  const NOW = new Date(2026, 9, 25, 12).getTime();
  const mk = (id: number, at: number, status: AgentActivity["status"], detail = {}): AgentActivity => ({ id, at, agent: "cli", method: "m", summary: "s", status, detail });
  it("puts approvals first then groups by day", () => {
    const g = groupActivity([mk(1, NOW - 1000, "ok"), mk(2, NOW - 2000, "awaiting_approval"), mk(3, NOW - 86_400_000 * 3, "error"), mk(4, NOW - 3000, "ok")], NOW, dateGroupLabel);
    expect(g[0]).toMatchObject({ label: "Needs your approval", attention: true });
    expect(g[1]?.items.map((i) => i.id)).toEqual([1, 4]);
    expect(g).toHaveLength(3);
  });
  it("reads the scheduled id and labels statuses", () => {
    expect(scheduledIdOf(mk(1, NOW, "awaiting_approval", { scheduledId: 7 }))).toBe(7);
    expect(scheduledIdOf(mk(1, NOW, "awaiting_approval", { scheduledId: "7" }))).toBeNull();
    for (const s of ["ok", "error", "awaiting_approval", "approved", "denied"] as const) expect(statusLabel(s)).toBeTruthy();
  });
});

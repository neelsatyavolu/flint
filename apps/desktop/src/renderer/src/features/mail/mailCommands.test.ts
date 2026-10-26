import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadPage, ThreadQuery } from "@flint/core";
import { buildEntries } from "../../state/grouping";
import { listStore } from "../../state/listStore";
import { navStore } from "../../state/nav";
import { bundle, item } from "../../state/testFixtures";
import { blockRowSender, bundleThreadIds, deleteDraftRow, DRAFT_UNDO_MS, selectAll } from "./mailCommands";

const hoisted = vi.hoisted(() => ({ deleteDraft: vi.fn(), blockSender: vi.fn(), unblockSender: vi.fn() }));
vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<{ flint: object }>();
  return { ...real, flint: new Proxy(real.flint, { get: (t, k) => (k in hoisted ? hoisted[k as keyof typeof hoisted] : Reflect.get(t, k)) }) };
});

const drafts = [1, 2, 3].map((n) => item(-n, { draft: { draftId: n, messageId: null }, hasDraft: true }));

function showRows(rows = drafts) {
  listStore.setState({ raw: rows, items: rows, hidden: [], entries: buildEntries(rows, []), status: "ready", nextCursor: null, error: null, query: null, queryKey: null });
}

describe("deferred draft delete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(hoisted).forEach((f) => f.mockReset().mockResolvedValue(undefined));
    showRows();
  });
  afterEach(() => vi.useRealTimers());

  it("hides the rows at once and shows one toast for deletes in the same tick", async () => {
    const notify = vi.fn();
    void deleteDraftRow(1, notify);
    void deleteDraftRow(2, notify);
    expect(listStore.getState().items.map((i) => i.id)).toEqual([-3]);
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toMatchObject({ message: "Deleted 2 drafts", timeout: DRAFT_UNDO_MS, action: { label: "Undo" } });
    expect(hoisted.deleteDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DRAFT_UNDO_MS);
    expect(hoisted.deleteDraft.mock.calls).toEqual([[1], [2]]);
  });

  it("Undo restores the rows and nothing is deleted", async () => {
    const notify = vi.fn();
    void deleteDraftRow(3, notify);
    await vi.advanceTimersByTimeAsync(0);
    expect(notify.mock.calls[0]![0].message).toBe("Draft deleted");
    notify.mock.calls[0]![0].action.onClick();
    expect(listStore.getState().items).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(DRAFT_UNDO_MS * 2);
    expect(hoisted.deleteDraft).not.toHaveBeenCalled();
  });

  it("puts a row back and says so when its delete fails", async () => {
    hoisted.deleteDraft.mockRejectedValue(new Error("offline"));
    const notify = vi.fn();
    void deleteDraftRow(1, notify);
    await vi.advanceTimersByTimeAsync(DRAFT_UNDO_MS);
    expect(notify).toHaveBeenLastCalledWith({ message: "Couldn't delete the draft. Try again.", level: "error" });
    expect(listStore.getState().items).toHaveLength(3);
  });
});

describe("block from the row menu", () => {
  beforeEach(() => Object.values(hoisted).forEach((f) => f.mockReset().mockResolvedValue(undefined)));

  it("blocks, offers an Undo that unblocks, then archives", async () => {
    const notify = vi.fn();
    const archive = vi.fn(async () => undefined);
    const row = item(7, { participants: [{ name: "me", address: "me@x.test" }, { name: "Spammy", address: "spam@x.test" }] });
    await blockRowSender(row, notify, archive);
    expect(hoisted.blockSender).toHaveBeenCalledWith("spam@x.test");
    expect(notify.mock.calls[0]![0].message).toBe("Blocked spam@x.test. Their mail goes to Blocked");
    expect(archive).toHaveBeenCalledWith([7]);
    notify.mock.calls[0]![0].action.onClick();
    expect(hoisted.unblockSender).toHaveBeenCalledWith("spam@x.test");
  });

  it("reports a failure and leaves the row alone", async () => {
    hoisted.blockSender.mockRejectedValue(new Error("offline"));
    const notify = vi.fn();
    const archive = vi.fn(async () => undefined);
    await blockRowSender(item(7), notify, archive);
    expect(notify).toHaveBeenCalledWith({ message: "Couldn't block carla@x.test. Try again.", level: "error" });
    expect(archive).not.toHaveBeenCalled();
  });
});

describe("bundle triage ids", () => {
  it("pages through the whole bundle 200 at a time", async () => {
    const all = Array.from({ length: 450 }, (_, i) => i + 1);
    const listThreads = vi.fn(async (q: ThreadQuery): Promise<ThreadPage> => {
      const start = q.cursor ? Number(q.cursor) : 0;
      const next = start + q.limit! < all.length ? String(start + q.limit!) : null;
      return { items: all.slice(start, start + q.limit!).map((id) => item(id)), bundles: [], nextCursor: next };
    });
    const ids = await bundleThreadIds("newsletters", "a1", true, { listThreads });
    expect(ids).toEqual(all);
    expect(listThreads).toHaveBeenCalledTimes(3);
    expect(listThreads.mock.calls[0]![0]).toEqual({ view: "inbox", category: "newsletters", accountId: "a1", limit: 200, unreadOnly: true });
  });
});

describe("select all", () => {
  it("selects every loaded conversation and skips bundle rows", () => {
    const rows = [item(1), item(2)];
    listStore.setState({ entries: buildEntries(rows, [bundle("newsletters", Date.UTC(2026, 9, 25, 13))]) });
    selectAll();
    expect(navStore.getState().selected).toEqual([1, 2]);
    navStore.getState().clearSelected();
  });
});

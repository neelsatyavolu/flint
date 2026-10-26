import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadPage, ThreadQuery } from "@flint/core";
import { buildEntries } from "../../state/grouping";
import { listStore } from "../../state/listStore";
import { navStore } from "../../state/nav";
import { bundle, item } from "../../state/testFixtures";
import { bundleThreadIds, deleteDraftRow, DRAFT_UNDO_MS, flushDraftDeletes, selectAll } from "./mailCommands";

const hoisted = vi.hoisted(() => ({ deleteDraft: vi.fn() }));
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

  /** The toast the delete showed: what a ToastProvider would get. */
  const toastOf = (notify: ReturnType<typeof vi.fn>, call = 0) => notify.mock.calls[call]![0] as { message: string; onDismiss: () => void; action: { onClick: () => void } };

  it("hides the rows at once, shows one toast for deletes in the same tick, and deletes once the toast goes", async () => {
    const notify = vi.fn();
    void deleteDraftRow(1, notify);
    void deleteDraftRow(2, notify);
    expect(listStore.getState().items.map((i) => i.id)).toEqual([-3]);
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(toastOf(notify)).toMatchObject({ message: "Deleted 2 drafts", timeout: DRAFT_UNDO_MS, action: { label: "Undo" } });
    // Only the toast going commits: a toast held open by hover keeps its Undo working past DRAFT_UNDO_MS.
    await vi.advanceTimersByTimeAsync(DRAFT_UNDO_MS * 3);
    expect(hoisted.deleteDraft).not.toHaveBeenCalled();
    toastOf(notify).onDismiss();
    toastOf(notify).onDismiss();
    await vi.advanceTimersByTimeAsync(0);
    expect(hoisted.deleteDraft.mock.calls).toEqual([[1], [2]]);
  });

  it("Undo restores the rows and nothing is deleted", async () => {
    const notify = vi.fn();
    void deleteDraftRow(3, notify);
    await vi.advanceTimersByTimeAsync(0);
    expect(toastOf(notify).message).toBe("Draft deleted");
    toastOf(notify).action.onClick();
    expect(listStore.getState().items).toHaveLength(3);
    toastOf(notify).onDismiss();
    await vi.advanceTimersByTimeAsync(0);
    expect(hoisted.deleteDraft).not.toHaveBeenCalled();
  });

  it("says Undo is too late once the delete has run", async () => {
    const notify = vi.fn();
    void deleteDraftRow(3, notify);
    await vi.advanceTimersByTimeAsync(0);
    flushDraftDeletes();
    await vi.advanceTimersByTimeAsync(0);
    expect(hoisted.deleteDraft).toHaveBeenCalledWith(3);
    toastOf(notify).action.onClick();
    expect(notify).toHaveBeenLastCalledWith({ message: "Too late to undo. The draft is already deleted.", level: "error" });
  });

  it("commits waiting deletes when the page goes away or the list changes", async () => {
    const notify = vi.fn();
    void deleteDraftRow(1, notify);
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(hoisted.deleteDraft).toHaveBeenCalledWith(1);

    void deleteDraftRow(2, notify);
    await vi.advanceTimersByTimeAsync(0);
    listStore.setState({ queryKey: "elsewhere" });
    await vi.advanceTimersByTimeAsync(0);
    expect(hoisted.deleteDraft).toHaveBeenCalledWith(2);
    listStore.setState({ queryKey: null });
  });

  it("clears the last undo so Cmd+Z cannot undo an older thread action instead", async () => {
    navStore.getState().setLastUndo("archive-token");
    void deleteDraftRow(1, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(navStore.getState().lastUndoToken).toBeNull();
    flushDraftDeletes();
  });

  it("puts a row back and says so when its delete fails", async () => {
    hoisted.deleteDraft.mockRejectedValue(new Error("offline"));
    const notify = vi.fn();
    void deleteDraftRow(1, notify);
    await vi.advanceTimersByTimeAsync(0);
    toastOf(notify).onDismiss();
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenLastCalledWith({ message: "Couldn't delete the draft. Try again.", level: "error" });
    expect(listStore.getState().items).toHaveLength(3);
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

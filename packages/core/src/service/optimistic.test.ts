import { describe, expect, it, vi } from "vitest";
import type { ActionReport, ServerActions } from "../mail/actions";
import { makeStore, msg, seedImap } from "../store/testkit";
import { createOptimistic } from "./optimistic";
import { UndoRegistry } from "./undo";

const ok: ActionReport = { ok: true, errors: [], failedMessageIds: [] };

function setup() {
  const store = makeStore();
  const s = seedImap(store);
  const out = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1 }), msg({ uid: 2, subject: "Other topic" })]);
  const calls: string[] = [];
  const actions = {
    setSeen: async (locs: unknown[], seen: boolean) => { calls.push(`seen:${seen}:${locs.length}`); return ok; },
    archive: async (locs: unknown[]) => { calls.push(`archive:${locs.length}`); return ok; },
    moveToFolder: async (locs: unknown[], folderId: number) => { calls.push(`folder:${folderId}:${locs.length}`); return ok; },
  } as unknown as ServerActions;
  const make = (a: ServerActions = actions) => createOptimistic({ store, emit: () => undefined, undo: new UndoRegistry({ now: () => 0 }), actionsFor: () => a, caller: () => undefined, now: () => 1000 });
  return { store, s, out, calls, actions, make };
}

describe("durable outbox", () => {
  it("records the operation while it runs and removes it when it finishes", async () => {
    const { store, out, make } = setup();
    let during = 0;
    const o = make();
    await o.run({
      label: "mark as read", local: () => store.markRead([out[0]!.threadId], true), op: { kind: "seen", arg: true },
      server: async (a, l) => { during = store.listPendingOps().length; return a.setSeen(l, true); },
    });
    expect(during).toBe(1);
    await vi.waitFor(() => expect(store.listPendingOps()).toEqual([]));
  });

  it("removes the record when the server refuses and the change is rolled back", async () => {
    const { store, out, make } = setup();
    const bad = { setSeen: async () => ({ ok: false, errors: [{ message: "no" }], failedMessageIds: [out[0]!.messageRowId] }) } as unknown as ServerActions;
    await make(bad).run({ label: "mark as read", local: () => store.markRead([out[0]!.threadId], true), op: { kind: "seen", arg: true }, server: (a, l) => a.setSeen(l, true) });
    await vi.waitFor(() => expect(store.listPendingOps()).toEqual([]));
  });

  it("replays an operation the app was killed in the middle of", async () => {
    const { store, out, calls, make } = setup();
    const hang = new Promise<never>(() => undefined); // the process dies here: the promise never settles
    void make().run({ label: "archive", local: () => store.moveThreads([out[0]!.threadId], { kind: "archive" }), op: { kind: "archive" }, server: () => hang });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.listPendingOps()).toMatchObject([{ kind: "archive", messageIds: [out[0]!.messageRowId], attempts: 0 }]);

    expect(await make().replayPending()).toBe(1);
    expect(calls).toEqual(["archive:1"]);
    expect(store.listPendingOps()).toEqual([]);
  });

  it("carries arguments through a replay", async () => {
    const { store, s, out, calls, make } = setup();
    store.addPendingOp(s.account.id, { kind: "seen", arg: false }, [out[1]!.messageRowId], 0);
    store.addPendingOp(s.account.id, { kind: "move_folder", arg: s.archive.id }, [out[1]!.messageRowId], 0);
    await make().replayPending();
    expect(calls).toEqual(["seen:false:1", `folder:${s.archive.id}:1`]);
  });

  it("gives up after repeated failures, on vanished messages, and on stale records", async () => {
    const { store, s, out, make } = setup();
    const refuse = { archive: async () => ({ ok: false, errors: [{ message: "no" }], failedMessageIds: [out[0]!.messageRowId] }) } as unknown as ServerActions;
    const id = store.addPendingOp(s.account.id, { kind: "archive" }, [out[0]!.messageRowId], 0);
    const o = make(refuse);
    await o.replayPending();
    await o.replayPending();
    expect(store.listPendingOps()[0]).toMatchObject({ id, attempts: 2 });
    await o.replayPending();
    expect(store.listPendingOps()).toEqual([]);

    store.addPendingOp(s.account.id, { kind: "archive" }, [999_999], 0);
    await make().replayPending();
    expect(store.listPendingOps()).toEqual([]);

    store.addPendingOp(s.account.id, { kind: "archive" }, [out[0]!.messageRowId], -1);
    await createOptimistic({ store, emit: () => undefined, undo: new UndoRegistry({ now: () => 0 }), actionsFor: () => refuse, caller: () => undefined, now: () => 10 * 24 * 3600 * 1000 }).replayPending();
    expect(store.listPendingOps()).toEqual([]);
  });
});

describe("who waits for the server", () => {
  /** A server whose archive answers only when the test releases it. `refuse` names the messages it then refuses. */
  function gated(refuse: () => number[] = () => []) {
    const calls: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const actions = {
      archive: async () => {
        calls.push("archive");
        await gate;
        const failed = refuse();
        return { ok: failed.length === 0, errors: failed.map(() => ({ message: "no" })), failedMessageIds: failed };
      },
      moveToInbox: async () => { calls.push("moveToInbox"); return ok; },
    } as unknown as ServerActions;
    return { actions, calls, release: () => release() };
  }

  function make(store: ReturnType<typeof setup>["store"], actions: ServerActions, agent?: string) {
    const events: string[] = [];
    const o = createOptimistic({ store, emit: (e) => events.push(e.type), undo: new UndoRegistry({ now: () => 0 }), actionsFor: () => actions, caller: () => agent, now: () => 1000 });
    return { o, events };
  }

  it("gives the UI its undo token before the server answers", async () => {
    const { store, out } = setup();
    const g = gated();
    const { o, events } = make(store, g.actions);
    const { undoToken } = await o.run({ label: "archive", local: () => store.moveThreads([out[0]!.threadId], { kind: "archive" }), server: (a, l) => a.archive(l), op: { kind: "archive" } });
    expect(undoToken).toBeTruthy();
    expect(g.calls).toEqual(["archive"]);
    expect(store.listPendingOps()).toHaveLength(1);
    g.release();
    await vi.waitFor(() => expect(store.listPendingOps()).toEqual([]));
    expect(events).toEqual(["mail_changed"]);
  });

  it("makes agent callers wait for the server and throws when it refuses", async () => {
    const { store, out } = setup();
    const g = gated(() => [out[0]!.messageRowId]);
    const { o, events } = make(store, g.actions, "claude");
    let settled = false;
    const p = o.run({ label: "archive", local: () => store.moveThreads([out[0]!.threadId], { kind: "archive" }), server: (a, l) => a.archive(l) });
    p.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    g.release();
    await expect(p).rejects.toMatchObject({ code: "network" });
    expect(events).toEqual(["mail_changed", "mail_changed"]);
  });

  it("toasts a background refusal for the UI and restores the thread", async () => {
    const { store, out } = setup();
    const g = gated(() => [out[0]!.messageRowId]);
    const { o, events } = make(store, g.actions);
    await o.run({ label: "archive", local: () => store.moveThreads([out[0]!.threadId], { kind: "archive" }), server: (a, l) => a.archive(l) });
    expect(store.listThreads({ view: "archive" }).items).toHaveLength(1);
    g.release();
    await vi.waitFor(() => expect(events).toEqual(["mail_changed", "mail_changed", "toast"]));
    expect(store.listThreads({ view: "archive" }).items).toHaveLength(0);
  });

  it("an undo made while the server is busy waits for it, then runs the inverse", async () => {
    const { store, out } = setup();
    const g = gated();
    const { o } = make(store, g.actions);
    const { undoToken } = await o.run({ label: "archive", local: () => store.moveThreads([out[0]!.threadId], { kind: "archive" }), server: (a, l) => a.archive(l), inverse: (a, l) => a.moveToInbox(l) });
    const undone = o.undo(undoToken);
    expect(store.listThreads({ view: "archive" }).items).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(g.calls).toEqual(["archive"]);
    g.release();
    await undone;
    expect(g.calls).toEqual(["archive", "moveToInbox"]);
  });

  it("an undo of a change the server then refuses skips the inverse and the toast", async () => {
    const { store, out } = setup();
    const g = gated(() => [out[0]!.messageRowId]);
    const { o, events } = make(store, g.actions);
    const { undoToken } = await o.run({ label: "archive", local: () => store.moveThreads([out[0]!.threadId], { kind: "archive" }), server: (a, l) => a.archive(l), inverse: (a, l) => a.moveToInbox(l) });
    const undone = o.undo(undoToken);
    g.release();
    await undone;
    await new Promise((r) => setTimeout(r, 10));
    expect(g.calls).toEqual(["archive"]);
    expect(events).not.toContain("toast");
    expect(store.listThreads({ view: "inbox" }).items.map((t) => t.id)).toContain(out[0]!.threadId);
  });
});

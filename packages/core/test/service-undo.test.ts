import { describe, expect, it, vi } from "vitest";
import type { ActionReport, ServerActions } from "../src/mail/actions";
import { createOptimistic } from "../src/service/optimistic";
import { UndoRegistry } from "../src/service/undo";
import { makeStore, msg, seedImap } from "../src/store/testkit";
import { FlintError, type FlintEvent } from "../src/types";

const snapshot = { version: 1 as const, threads: [] };

describe("UndoRegistry", () => {
  it("hands an entry out once", () => {
    const undo = new UndoRegistry();
    const token = undo.register({ label: "archive", snapshot, affected: [1] });
    expect(undo.take(token).affected).toEqual([1]);
    expect(() => undo.take(token)).toThrow(FlintError);
  });

  it("expires entries after 30 seconds", () => {
    let now = 1_000;
    const undo = new UndoRegistry({ now: () => now });
    const token = undo.register({ label: "archive", snapshot, affected: [] });
    now += 29_999;
    expect(undo.size).toBe(1);
    now += 2;
    expect(() => undo.take(token)).toThrow(/can't be undone/);
    expect(undo.size).toBe(0);
  });

  it("rejects unknown tokens and gives each registration its own token", () => {
    const undo = new UndoRegistry();
    expect(() => undo.take("nope")).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(undo.register({ label: "a", snapshot, affected: [] })).not.toBe(undo.register({ label: "a", snapshot, affected: [] }));
  });

  it("discard removes an entry", () => {
    const undo = new UndoRegistry();
    const token = undo.register({ label: "a", snapshot, affected: [] });
    undo.discard(token);
    expect(() => undo.take(token)).toThrow(FlintError);
  });
});

function setup(agent?: string) {
  const store = makeStore();
  const seed = seedImap(store);
  store.ingestMessages(seed.account.id, seed.inbox.id, [msg({ uid: 1, subject: "One" })]);
  const threadId = store.listThreads({ view: "inbox" }).items[0]!.id;
  const events: FlintEvent[] = [];
  const calls: string[] = [];
  const report = (ok: boolean, locs: { messageRowId: number }[]): ActionReport => ({
    ok, errors: ok ? [] : locs.map((l) => ({ op: "archive", messageRowId: l.messageRowId, folderPath: "INBOX", uid: 1, message: "refused" })),
    failedMessageIds: ok ? [] : locs.map((l) => l.messageRowId),
  });
  let serverOk = false;
  const fake = {
    archive: async (locs: { messageRowId: number }[]) => { calls.push("archive"); return report(serverOk, locs); },
    moveToInbox: async (locs: { messageRowId: number }[]) => { calls.push("moveToInbox"); return report(true, locs); },
  } as unknown as ServerActions;
  const undo = new UndoRegistry();
  const optimistic = createOptimistic({ store, emit: (e) => events.push(e), undo, actionsFor: () => fake, caller: () => agent });
  const archive = () => optimistic.run({
    label: "archive",
    local: () => store.moveThreads([threadId], { kind: "archive" }),
    server: (a, l) => a.archive(l),
    inverse: (a, l) => a.moveToInbox(l),
  });
  return { store, threadId, events, calls, undo, optimistic, archive, setServerOk: (v: boolean) => { serverOk = v; } };
}

describe("optimistic actions", () => {
  it("changes the store and emits before the server answers, and keeps the change when the server accepts", async () => {
    const s = setup();
    s.setServerOk(true);
    const { undoToken } = await s.archive();
    expect(s.store.listThreads({ view: "inbox" }).items).toHaveLength(0);
    expect(s.store.listThreads({ view: "archive" }).items).toHaveLength(1);
    expect(s.events.filter((e) => e.type === "mail_changed")).toHaveLength(1);
    expect(s.events.some((e) => e.type === "toast")).toBe(false);
    expect(undoToken).toBeTruthy();
  });

  it("restores the thread and shows a toast when the server refuses", async () => {
    const s = setup();
    await s.archive();
    // The UI gets its token at once; the refusal arrives in the background.
    await vi.waitFor(() => expect(s.events.map((e) => e.type)).toEqual(["mail_changed", "mail_changed", "toast"]));
    expect(s.store.listThreads({ view: "inbox" }).items.map((t) => t.id)).toEqual([s.threadId]);
    expect(s.events[2]).toMatchObject({ type: "toast", level: "error", message: "Couldn't archive. The change was undone." });
    expect(s.undo.size).toBe(0);
  });

  it("throws for agent callers instead of toasting", async () => {
    const s = setup("claude");
    await expect(s.archive()).rejects.toMatchObject({ code: "network" });
    expect(s.events.some((e) => e.type === "toast")).toBe(false);
    expect(s.store.listThreads({ view: "inbox" }).items).toHaveLength(1);
  });

  it("undo restores the store and runs the inverse on the server", async () => {
    const s = setup();
    s.setServerOk(true);
    const { undoToken } = await s.archive();
    await s.optimistic.undo(undoToken);
    expect(s.calls).toEqual(["archive", "moveToInbox"]);
    expect(s.store.listThreads({ view: "inbox" }).items).toHaveLength(1);
    await expect(s.optimistic.undo(undoToken)).rejects.toMatchObject({ code: "not_found" });
  });
});

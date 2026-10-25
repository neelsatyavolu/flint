import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tryStartGreenMail, type GreenMail } from "./greenmail";
import { addr, makeRig, uidsIn, waitFor, type Rig } from "./harness";

const gm: GreenMail | null = await tryStartGreenMail({ users: ["alice", "bob", "carol", "dave", "erin", "frank", "gina", "hank", "ivan", "judy"] });
afterAll(async () => { await gm?.stop(); });

async function flagsOnServer(rig: Rig, path: string, as?: string): Promise<string[][]> {
  return rig.server(async (c) => {
    const lock = await c.getMailboxLock(path, { readOnly: true });
    try {
      return (await c.fetchAll("1:*", { flags: true })).map((m) => [...(m.flags ?? [])]);
    } finally { lock.release(); }
  }, as);
}

async function seeded(name: string, subject: string): Promise<{ rig: Rig; threadId: number }> {
  const rig = makeRig(gm!, name);
  await gm!.deliver({ to: addr(name), subject, text: "body" });
  await rig.sync.syncNow();
  const threadId = rig.store.listThreads({ view: "inbox" }).items[0]!.id;
  return { rig, threadId };
}

describe.skipIf(!gm)("server actions against GreenMail", { timeout: 30_000 }, () => {
  beforeAll(() => undefined);

  it("sets and clears \\Seen and \\Flagged", async () => {
    const { rig, threadId } = await seeded("alice", "Flags");
    const read = rig.store.markRead([threadId], true);
    expect((await rig.sync.actions.setSeen(read.locations, true)).ok).toBe(true);
    const pin = rig.store.setPinned([threadId], true);
    expect((await rig.sync.actions.setFlagged(pin.locations, true)).ok).toBe(true);
    expect((await flagsOnServer(rig, "INBOX"))[0]).toEqual(expect.arrayContaining(["\\Seen", "\\Flagged"]));

    const unread = rig.store.markRead([threadId], false);
    await rig.sync.actions.setSeen(unread.locations, false);
    expect((await flagsOnServer(rig, "INBOX"))[0]).not.toContain("\\Seen");
  });

  it("archives into a created Archive folder and stays consistent after the next sync", async () => {
    const { rig, threadId } = await seeded("bob", "To archive");
    const moved = rig.store.moveThreads([threadId], { kind: "archive" });
    const rep = await rig.sync.actions.archive(moved.locations);
    expect(rep).toMatchObject({ ok: true, errors: [] });
    expect(await uidsIn(rig, "INBOX")).toHaveLength(0);
    expect(await uidsIn(rig, "Archive")).toHaveLength(1);

    await rig.sync.syncNow();
    expect(rig.store.listThreads({ view: "archive" }).items).toHaveLength(1);
    expect(rig.store.listThreads({ view: "inbox" }).items).toHaveLength(0);
    const rows = rig.store.getThreadRows(threadId)!;
    expect(rows.messages).toHaveLength(1); // adopted, not duplicated
  });

  it("trashes, marks as spam and moves back to the inbox", async () => {
    const { rig, threadId } = await seeded("carol", "Round trip");
    await rig.server(async (c) => { await c.mailboxCreate("Trash"); await c.mailboxCreate("Junk"); });
    await rig.sync.syncNow(); // LIST finds both and assigns their roles
    const trashed = rig.store.moveThreads([threadId], { kind: "trash" });
    expect((await rig.sync.actions.trash(trashed.locations)).ok).toBe(true);
    expect(await uidsIn(rig, "Trash")).toHaveLength(1);
    expect(await uidsIn(rig, "INBOX")).toHaveLength(0);

    const spam = rig.store.moveThreads([threadId], { kind: "spam" });
    expect((await rig.sync.actions.spam(spam.locations)).ok).toBe(true);
    expect(await uidsIn(rig, "Junk")).toHaveLength(1);
    expect(await uidsIn(rig, "Trash")).toHaveLength(0);

    const back = rig.store.moveThreads([threadId], { kind: "inbox" });
    expect((await rig.sync.actions.moveToInbox(back.locations)).ok).toBe(true);
    expect(await uidsIn(rig, "INBOX")).toHaveLength(1);
    await rig.sync.syncNow();
    expect(rig.store.listThreads({ view: "inbox" }).items).toHaveLength(1);
    expect(rig.store.listThreads({ view: "spam" }).items).toHaveLength(0);
  });

  it("moves to a user folder", async () => {
    const { rig, threadId } = await seeded("dave", "File me");
    await rig.server(async (c) => { await c.mailboxCreate("Projects"); });
    await rig.sync.syncNow(); // discovers the folder
    const folder = rig.store.getFolderByPath(rig.account.id, "Projects")!;
    expect(folder).toBeTruthy();
    const moved = rig.store.moveThreads([threadId], { kind: "folder", folderId: folder.id });
    expect((await rig.sync.actions.moveToFolder(moved.locations, folder.id)).ok).toBe(true);
    expect(await uidsIn(rig, "Projects")).toHaveLength(1);
    expect(await uidsIn(rig, "INBOX")).toHaveLength(0);
    // Opening the folder syncs it, then it stays in the sync set.
    await rig.sync.syncFolderNow(folder.id);
    expect(rig.store.listThreads({ view: "folder", folderId: folder.id }).items).toHaveLength(1);
  });

  it("returns an error per message when the server operation fails", async () => {
    const { rig, threadId } = await seeded("erin", "Doomed");
    const r = rig.store.markRead([threadId], true);
    const broken = r.locations.map((l) => ({ ...l, folderPath: "Does/Not/Exist" }));
    const rep = await rig.sync.actions.setSeen(broken, true);
    expect(rep.ok).toBe(false);
    expect(rep.errors).toHaveLength(1);
    expect(rep.errors[0]).toMatchObject({ op: "setSeen", messageRowId: broken[0]!.messageRowId });
    expect(rep.failedMessageIds).toEqual([broken[0]!.messageRowId]);
    // The caller can put the optimistic change back.
    rig.store.restoreSnapshot(r.snapshot);
    expect(rig.store.listThreads({ view: "inbox" }).items[0]!.unreadCount).toBe(1);
  });

  it("trashes blocked senders and applies rule actions to new mail", async () => {
    const rig = makeRig(gm!, "frank");
    await gm!.deliver({ to: addr("frank"), subject: "Existing", text: "already here" });
    await rig.sync.syncNow(); // initial sync does not evaluate rules
    rig.store.blockSender("spammer@bad.example");
    rig.store.saveRule({ name: "Promos", enabled: true, accountId: null, match: "all", sortOrder: 0, conditions: [{ field: "subject", op: "contains", value: "PROMO" }], actions: [{ type: "archive" }, { type: "mark_read" }] });
    await gm!.deliver({ to: addr("frank"), subject: "Buy now", text: "x", from: "Spam <spammer@bad.example>" });
    await gm!.deliver({ to: addr("frank"), subject: "PROMO: 20% off", text: "x", from: "Shop <deals@shop.example>" });
    await gm!.deliver({ to: addr("frank"), subject: "Normal mail", text: "x", from: "Ann <ann@remote.example>" });
    await rig.sync.syncNow();

    await waitFor(async () => (await uidsIn(rig, "Trash")).length === 1, "blocked mail in Trash");
    expect(await uidsIn(rig, "Archive")).toHaveLength(1);
    const inbox = await uidsIn(rig, "INBOX");
    expect(inbox).toHaveLength(2); // Existing + Normal mail
    const subjects = rig.store.listThreads({ view: "inbox" }).items.map((t) => t.subject).sort();
    expect(subjects).toEqual(["Existing", "Normal mail"]);
    expect(rig.store.listThreads({ view: "archive" }).items.map((t) => t.subject)).toEqual(["PROMO: 20% off"]);
    expect((await flagsOnServer(rig, "Archive"))[0]).toContain("\\Seen");
  });

  it("applies move, pin, trash and notify rule actions", async () => {
    const rig = makeRig(gm!, "hank");
    await rig.server(async (c) => { await c.mailboxCreate("Receipts"); await c.mailboxCreate("Trash"); });
    await gm!.deliver({ to: addr("hank"), subject: "Seed", text: "seed" });
    await rig.sync.syncNow();
    const rules = [
      { name: "File receipts", conditions: [{ field: "subject" as const, op: "contains" as const, value: "Receipt" }], actions: [{ type: "move" as const, folderPath: "Receipts" }] },
      { name: "Pin boss", conditions: [{ field: "from" as const, op: "contains" as const, value: "boss@" }], actions: [{ type: "pin" as const }, { type: "notify" as const, enabled: true }] },
      { name: "Bin junk", conditions: [{ field: "subject" as const, op: "contains" as const, value: "JUNK" }], actions: [{ type: "trash" as const }] },
    ];
    rules.forEach((r, i) => rig.store.saveRule({ ...r, enabled: true, accountId: null, match: "all", sortOrder: i }));
    await gm!.deliver({ to: addr("hank"), subject: "Receipt #1", text: "x", from: "Shop <shop@shop.example>" });
    await gm!.deliver({ to: addr("hank"), subject: "Weekly plan", text: "x", from: "Boss <boss@work.example>" });
    await gm!.deliver({ to: addr("hank"), subject: "JUNK offer", text: "x", from: "Ads <ads@ads.example>" });
    await rig.sync.syncNow();

    expect(await uidsIn(rig, "Receipts")).toHaveLength(1);
    expect(await uidsIn(rig, "Trash")).toHaveLength(1);
    expect((await flagsOnServer(rig, "INBOX")).filter((f) => f.includes("\\Flagged"))).toHaveLength(1);
    const inbox = rig.store.listThreads({ view: "inbox" }).items.map((t) => t.subject).sort();
    expect(inbox).toEqual(["Seed", "Weekly plan"]);
    expect(rig.store.listThreads({ view: "pinned" }).items.map((t) => t.subject)).toEqual(["Weekly plan"]);
    expect(rig.events.filter((e) => e.type === "new_mail").map((e) => e.type === "new_mail" && e.subject)).toEqual(["Weekly plan"]);
  });

  it("puts the optimistic state back when a rule action fails on the server", async () => {
    const rig = makeRig(gm!, "ivan");
    await gm!.deliver({ to: addr("ivan"), subject: "Seed", text: "seed" });
    await rig.sync.syncNow();
    rig.store.saveRule({ name: "Pin", enabled: true, accountId: null, match: "all", sortOrder: 0, conditions: [{ field: "subject", op: "contains", value: "Pin me" }], actions: [{ type: "pin" }] });
    // Make the server refuse flag changes by breaking the command connection for the first attempt.
    const real = rig.sync.actions.setFlagged.bind(rig.sync.actions);
    rig.sync.actions.setFlagged = async (locs, flagged) => ({ ...(await real([], flagged)), ok: false, errors: [{ op: "setFlagged", messageRowId: locs[0]!.messageRowId, folderPath: "INBOX", uid: locs[0]!.uid, message: "refused" }], failedMessageIds: [locs[0]!.messageRowId] });
    await gm!.deliver({ to: addr("ivan"), subject: "Pin me", text: "x" });
    await rig.sync.syncNow();
    expect(rig.store.listThreads({ view: "pinned" }).items).toHaveLength(0);
    expect(rig.store.listThreads({ view: "inbox" }).items).toHaveLength(2);
  });

  it("resyncs a folder whose UIDVALIDITY changed", async () => {
    const { rig } = await seeded("gina", "Before");
    const inbox = rig.store.getFolderByPath(rig.account.id, "INBOX")!;
    rig.store.setFolderSyncState(inbox.id, { uidValidity: 12345 });
    await rig.sync.syncNow();
    const items = rig.store.listThreads({ view: "inbox" }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.subject).toBe("Before");
    expect(rig.store.getFolderSyncState(inbox.id).uidValidity).not.toBe(12345);
  });
});

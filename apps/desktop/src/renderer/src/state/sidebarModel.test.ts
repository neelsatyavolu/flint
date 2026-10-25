import { describe, expect, it } from "vitest";
import type { Folder, SidebarData, SyncStatus } from "@flint/core";
import { isActiveTarget, moreFolders, sidebarCounts, syncSummary } from "./sidebarModel";

const folder = (id: number, name: string, role: Folder["role"]): Folder => ({ id, accountId: "a1", path: name, name, role, unread: 0, total: 0 });
const acct = (id: string, unread: number, sync: SyncStatus["state"], error?: string) => ({
  account: { id, email: `${id}@x.test` } as never,
  inboxUnread: unread,
  folders: [],
  sync: { accountId: id, state: sync, error },
});
const data = (accounts: ReturnType<typeof acct>[]): SidebarData => ({
  accounts,
  counts: { inbox: 9, pinned: 1, drafts: 2, snoozed: 3, scheduled: 4, awaitingApproval: 5, spam: 0 },
});

describe("sidebarModel", () => {
  it("reads counts and per-account unread", () => {
    const c = sidebarCounts(data([acct("a1", 4, "idle"), acct("a2", 5, "idle")]));
    expect(c).toMatchObject({ inbox: 9, pinned: 1, drafts: 2, snoozed: 3, scheduled: 4, awaitingApproval: 5 });
    expect(c.byAccount).toEqual({ a1: 4, a2: 5 });
  });

  it("is all zeros before data arrives", () => {
    expect(sidebarCounts(undefined).inbox).toBe(0);
    expect(syncSummary(undefined)).toEqual({ syncing: false, problems: [] });
  });

  it("flags syncing and problems", () => {
    const s = syncSummary(data([acct("a1", 0, "syncing"), acct("a2", 0, "auth_error"), acct("a3", 0, "error", "Server said no"), acct("a4", 0, "offline")]));
    expect(s.syncing).toBe(true);
    expect(s.problems.map((p) => [p.accountId, p.message, p.needsSignIn])).toEqual([
      ["a2", "Sign in again", true],
      ["a3", "Server said no", false],
      ["a4", "Offline. Flint retries every minute.", false],
    ]);
  });

  it("falls back to generic copy for an error without detail", () => {
    expect(syncSummary(data([acct("a1", 0, "error")])).problems[0]?.message).toBe("Sync failed");
  });

  it("lists user folders and spare roles under More, leaving out roles with their own row", () => {
    const list = moreFolders([folder(1, "Inbox", "inbox"), folder(2, "Spam", "spam"), folder(3, "Zed", null), folder(4, "Alpha", null), folder(5, "Sent", "sent"), folder(6, "Starred", "flagged")]);
    expect(list.map((f) => f.name)).toEqual(["Starred", "Alpha", "Zed"]);
  });

  it("matches a sidebar row to navigation", () => {
    expect(isActiveTarget({ view: "inbox" }, { view: "inbox" })).toBe(true);
    expect(isActiveTarget({ view: "inbox", accountId: "a1" }, { view: "inbox" })).toBe(false);
    expect(isActiveTarget({ view: "inbox", accountId: "a1" }, { view: "inbox", accountId: "a1" })).toBe(true);
    expect(isActiveTarget({ view: "folder", folderId: 2 }, { view: "folder", folderId: 3 })).toBe(false);
  });
});

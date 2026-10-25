import { describe, expect, it } from "vitest";
import { makeStore } from "../store/testkit";
import { foldersForQuery, hasOlderOnServer } from "./historyFolders";

function setup(provider: "imap" | "gmail") {
  const store = makeStore();
  const account = store.createAccount({
    email: "me@x.test", name: "Me", provider, authKind: "password", username: "me",
    imapHost: "h", imapPort: 993, imapSecure: true, smtpHost: "h", smtpPort: 465, smtpSecure: true,
  });
  const f = (path: string, role: "inbox" | "sent" | "all" | "trash" | null) => store.upsertFolder(account.id, { path, name: path, delimiter: "/", role, specialUse: null });
  return { store, account, f };
}

describe("foldersForQuery", () => {
  it("maps generic views to their role folder and mixed views to inbox, sent and archive", () => {
    const { store, f } = setup("imap");
    const inbox = f("INBOX", "inbox"); const sent = f("Sent", "sent"); f("Projects", null);
    expect(foldersForQuery(store, { view: "inbox" })[0]!.folders.map((x) => x.id)).toEqual([inbox.id]);
    expect(foldersForQuery(store, { view: "sent" })[0]!.folders.map((x) => x.id)).toEqual([sent.id]);
    expect(foldersForQuery(store, { view: "pinned" })[0]!.folders.map((x) => x.id)).toEqual([inbox.id, sent.id]);
  });

  it("reads All Mail on Gmail except for trash, and a label folder maps to All Mail", () => {
    const { store, f } = setup("gmail");
    const all = f("[Gmail]/All Mail", "all"); const trash = f("[Gmail]/Trash", "trash"); const label = f("Receipts", null);
    expect(foldersForQuery(store, { view: "inbox" })[0]!.folders.map((x) => x.id)).toEqual([all.id]);
    expect(foldersForQuery(store, { view: "trash" })[0]!.folders.map((x) => x.id)).toEqual([trash.id]);
    expect(foldersForQuery(store, { view: "folder", folderId: label.id })[0]!.folders.map((x) => x.id)).toEqual([all.id]);
  });
});

describe("hasOlderOnServer", () => {
  it("is true only while a synced folder's lowest UID is above 1", () => {
    const { store, f } = setup("imap");
    const inbox = f("INBOX", "inbox");
    expect(hasOlderOnServer(store, { view: "inbox" })).toBe(false);
    store.setFolderSyncState(inbox.id, { uidNext: 500, syncedMinUid: 120 });
    expect(hasOlderOnServer(store, { view: "inbox" })).toBe(true);
    expect(hasOlderOnServer(store, { view: "search", search: "x" })).toBe(false);
    store.setFolderSyncState(inbox.id, { syncedMinUid: 1 });
    expect(hasOlderOnServer(store, { view: "inbox" })).toBe(false);
  });
});

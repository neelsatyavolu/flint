import { describe, expect, it } from "vitest";
import type { Folder, MailboxRole } from "../types";
import { sidebarFolders } from "./folderList";
import { makeStore, seedGmail } from "./testkit";

let id = 0;
const folder = (path: string, role: MailboxRole | null, name = path.split("/").pop()!): Folder => ({ id: ++id, accountId: "a", path, name, role, unread: 0, total: 0 });

describe("sidebarFolders", () => {
  it("hides the all, important and flagged duplicates", () => {
    const out = sidebarFolders([
      folder("INBOX", "inbox"), folder("[Gmail]/All Mail", "all"), folder("[Gmail]/Important", "important"), folder("[Gmail]/Starred", "flagged"),
      folder("[Gmail]/Sent Mail", "sent"), folder("Work", null),
    ]);
    expect(out.map((f) => f.path)).toEqual(["INBOX", "[Gmail]/Sent Mail", "Work"]);
  });

  it("renames a user label that collides with a system name", () => {
    const out = sidebarFolders([folder("[Gmail]/Important", "important"), folder("Important", null), folder("INBOX", "inbox")]);
    expect(out.map((f) => f.name)).toEqual(["Important (label)", "INBOX"]);
  });

  it("never shows two folders with the same name", () => {
    const out = sidebarFolders([folder("INBOX", "inbox"), folder("Clients/Acme", null), folder("Vendors/Acme", null), folder("Sent", null), folder("[Gmail]/Sent Mail", "sent")]);
    const names = out.map((f) => f.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(out.find((f) => f.path === "[Gmail]/Sent Mail")!.name).toBe("Sent Mail");
  });

  it("is what getSidebarData returns for a Gmail account", () => {
    const store = makeStore();
    const g = seedGmail(store);
    store.upsertFolder(g.account.id, { path: "[Gmail]/Important", role: "important" });
    store.upsertFolder(g.account.id, { path: "Important", role: null });
    const folders = store.getSidebarData().accounts[0]!.folders;
    expect(folders.some((f) => f.role === "all" || f.role === "important")).toBe(false);
    expect(folders.filter((f) => f.name === "Important")).toHaveLength(0);
    expect(folders.find((f) => f.path === "Important")!.name).toBe("Important (label)");
  });
});

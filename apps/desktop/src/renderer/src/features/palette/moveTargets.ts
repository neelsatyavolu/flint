import type { AccountId, Folder, MailboxRole, SidebarData } from "@flint/core";

const SKIP: MailboxRole[] = ["drafts", "sent", "all", "flagged", "important"];

/** Folders a thread can be moved to in one account: Inbox first, then other roles, then user folders by name. */
export function moveTargets(sidebar: SidebarData | undefined, accountId: AccountId | undefined): Folder[] {
  const all = sidebar?.accounts.find((a) => a.account.id === accountId)?.folders ?? [];
  return all
    .filter((f) => !f.role || !SKIP.includes(f.role))
    .sort((a, b) => Number(b.role === "inbox") - Number(a.role === "inbox") || Number(b.role !== null) - Number(a.role !== null) || a.name.localeCompare(b.name));
}

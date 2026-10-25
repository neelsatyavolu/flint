import type { Account, AccountId, Folder, SidebarData, SyncStatus } from "@flint/core";

export type SidebarCounts = {
  inbox: number;
  pinned: number;
  drafts: number;
  snoozed: number;
  scheduled: number;
  awaitingApproval: number;
  byAccount: Record<AccountId, number>;
};

export function sidebarCounts(data: SidebarData | undefined): SidebarCounts {
  const empty: SidebarCounts = { inbox: 0, pinned: 0, drafts: 0, snoozed: 0, scheduled: 0, awaitingApproval: 0, byAccount: {} };
  if (!data) return empty;
  const byAccount: Record<AccountId, number> = {};
  for (const a of data.accounts) byAccount[a.account.id] = a.inboxUnread;
  const { inbox, pinned, drafts, snoozed, scheduled, awaitingApproval } = data.counts;
  return { inbox, pinned, drafts, snoozed, scheduled, awaitingApproval, byAccount };
}

export type SyncSummary = {
  syncing: boolean;
  problems: { accountId: AccountId; email: string; state: SyncStatus["state"]; message: string; needsSignIn: boolean }[];
};

const PROBLEM_COPY: Partial<Record<SyncStatus["state"], string>> = {
  auth_error: "Sign in again",
  offline: "Offline. Flint retries every minute.",
  error: "Sync failed",
};

export function syncSummary(data: SidebarData | undefined): SyncSummary {
  const accounts = data?.accounts ?? [];
  const problems = accounts
    .filter((a) => a.sync.state in PROBLEM_COPY)
    .map((a) => ({
      accountId: a.account.id,
      email: a.account.email,
      state: a.sync.state,
      message: a.sync.state === "error" && a.sync.error ? a.sync.error : PROBLEM_COPY[a.sync.state] ?? "Sync failed",
      needsSignIn: a.sync.state === "auth_error",
    }));
  return { syncing: accounts.some((a) => a.sync.state === "syncing"), problems };
}

/** Folders shown under "More" for one account: user folders and roles without their own sidebar row. */
export function moreFolders(folders: Folder[]): Folder[] {
  const own = new Set(["inbox", "sent", "drafts", "trash", "archive"]);
  return folders
    .filter((f) => !f.role || !own.has(f.role))
    .sort((a, b) => Number(b.role !== null) - Number(a.role !== null) || a.name.localeCompare(b.name));
}

export function accountLabel(account: Account): string {
  return account.email;
}

export type NavMatch = { view: string; accountId?: AccountId; folderId?: number; category?: string };

/** Whether a sidebar row for `target` is the active one. A row without an account matches only the unscoped list. */
export function isActiveTarget(nav: NavMatch, target: { view: string; accountId?: AccountId; folderId?: number }): boolean {
  return nav.view === target.view && nav.accountId === target.accountId && nav.folderId === target.folderId;
}

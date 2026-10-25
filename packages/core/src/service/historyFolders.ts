import type { Store } from "../store";
import type { Account, Folder, MailboxRole, ThreadQuery } from "../types";

const VIEW_ROLE: Partial<Record<ThreadQuery["view"], MailboxRole>> = {
  inbox: "inbox", sent: "sent", drafts: "drafts", trash: "trash", spam: "spam", archive: "archive",
};

/** The server folders whose history backs this list, grouped by account. Gmail reads All Mail (Trash and Spam for their views). */
export function foldersForQuery(store: Store, query: ThreadQuery): { account: Account; folders: Folder[] }[] {
  const accounts = store.listAccounts().filter((a) => a.enabled && (query.accountId === undefined || a.id === query.accountId));
  const out: { account: Account; folders: Folder[] }[] = [];
  for (const account of accounts) {
    const all = store.listFolders(account.id);
    const byRole = (role: MailboxRole) => all.find((f) => f.role === role);
    const gmail = account.provider === "gmail" && byRole("all") !== undefined;
    let folders: (Folder | undefined)[];
    if (query.view === "folder") {
      const f = query.folderId === undefined ? undefined : all.find((x) => x.id === query.folderId);
      if (!f) continue;
      folders = [gmail && f.role === null ? byRole("all") : f];
    } else if (gmail) {
      folders = [byRole(query.view === "trash" ? "trash" : query.view === "spam" ? "spam" : "all")];
    } else {
      const role = VIEW_ROLE[query.view];
      folders = role ? [byRole(role)] : [byRole("inbox"), byRole("sent"), byRole("archive")];
    }
    const picked = folders.filter((f): f is Folder => f !== undefined);
    if (picked.length) out.push({ account, folders: picked });
  }
  return out;
}

/** True when a folder behind this list has older mail on the server that was never synced. No network. */
export function hasOlderOnServer(store: Store, query: ThreadQuery): boolean {
  if (query.view === "search" || query.view === "blocked") return false;
  return foldersForQuery(store, query).some(({ folders }) => folders.some((f) => {
    const s = store.getFolderSyncState(f.id);
    return s.uidNext !== null && s.syncedMinUid !== null && s.syncedMinUid > 1;
  }));
}

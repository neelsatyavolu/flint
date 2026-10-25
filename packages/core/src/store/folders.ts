import { FlintError, type AccountId, type Folder, type FolderId, type MailboxRole } from "../types";
import { rowToFolder, type FolderRow } from "./mappers";
import { deleteMessages } from "./rollup";
import type { Sql } from "./sql";
import type { FolderSyncState } from "./types";

export type FolderInput = { path: string; name?: string; delimiter?: string | null; role?: MailboxRole | null; specialUse?: string | null };

const COUNTS = `
  (SELECT COUNT(*) FROM message_folders mf JOIN messages m ON m.id = mf.message_id WHERE mf.folder_id = f.id AND m.seen = 0 AND m.draft = 0) AS unread,
  (SELECT COUNT(*) FROM message_folders mf WHERE mf.folder_id = f.id) AS total`;

const DEFAULT_PATHS: Partial<Record<MailboxRole, string>> = { archive: "Archive", trash: "Trash", spam: "Junk", sent: "Sent", drafts: "Drafts", inbox: "INBOX" };

function baseName(path: string, delimiter: string | null | undefined): string {
  const d = delimiter || "/";
  return path.split(d).pop() || path;
}

export class FoldersRepo {
  constructor(protected q: Sql) {}

  /** Creates or updates a folder by (account, path). A null role never clears an existing role. */
  upsertFolder(accountId: AccountId, input: FolderInput): Folder {
    this.q.run(
      `INSERT INTO folders (account_id, path, name, delimiter, role, special_use) VALUES (?,?,?,?,?,?)
       ON CONFLICT (account_id, path) DO UPDATE SET
         name = excluded.name,
         delimiter = COALESCE(excluded.delimiter, folders.delimiter),
         role = COALESCE(excluded.role, folders.role),
         special_use = COALESCE(excluded.special_use, folders.special_use)`,
      accountId, input.path, input.name ?? baseName(input.path, input.delimiter), input.delimiter ?? null, input.role ?? null, input.specialUse ?? null,
    );
    return this.getFolderByPath(accountId, input.path)!;
  }

  getFolder(id: FolderId): Folder | null {
    const r = this.q.get<FolderRow>(`SELECT f.*, ${COUNTS} FROM folders f WHERE f.id = ?`, id);
    return r ? rowToFolder(r) : null;
  }

  requireFolder(id: FolderId): Folder {
    const f = this.getFolder(id);
    if (!f) throw new FlintError("not_found", "That folder no longer exists.");
    return f;
  }

  getFolderByPath(accountId: AccountId, path: string): Folder | null {
    const r = this.q.get<FolderRow>(`SELECT f.*, ${COUNTS} FROM folders f WHERE f.account_id = ? AND f.path = ?`, accountId, path);
    return r ? rowToFolder(r) : null;
  }

  getFolderByRole(accountId: AccountId, role: MailboxRole): Folder | null {
    const r = this.q.get<FolderRow>(`SELECT f.*, ${COUNTS} FROM folders f WHERE f.account_id = ? AND f.role = ? ORDER BY f.id LIMIT 1`, accountId, role);
    return r ? rowToFolder(r) : null;
  }

  /** Returns the folder for a role, creating a local row (default path) when the server has none yet. */
  ensureFolderByRole(accountId: AccountId, role: MailboxRole): Folder {
    const found = this.getFolderByRole(accountId, role);
    if (found) return found;
    const path = DEFAULT_PATHS[role];
    if (!path) throw new FlintError("not_found", `This account has no ${role} folder yet.`);
    return this.upsertFolder(accountId, { path, role });
  }

  /** Folders with unread (unseen non-draft messages) and total message counts. Gmail counts come from labels via message_folders. */
  listFolders(accountId: AccountId): Folder[] {
    return this.q.all<FolderRow>(`SELECT f.*, ${COUNTS} FROM folders f WHERE f.account_id = ? ORDER BY f.name COLLATE NOCASE`, accountId).map(rowToFolder);
  }

  getFolderSyncState(folderId: FolderId): FolderSyncState {
    const r = this.q.get<{ uid_validity: number | null; uid_next: number | null; highest_modseq: string | null; synced_min_uid: number | null; last_sync_at: number | null }>(
      "SELECT uid_validity, uid_next, highest_modseq, synced_min_uid, last_sync_at FROM folders WHERE id = ?", folderId,
    );
    if (!r) throw new FlintError("not_found", "That folder no longer exists.");
    return { uidValidity: r.uid_validity, uidNext: r.uid_next, highestModseq: r.highest_modseq, syncedMinUid: r.synced_min_uid, lastSyncAt: r.last_sync_at };
  }

  setFolderSyncState(folderId: FolderId, patch: Partial<FolderSyncState>): void {
    const map: [keyof FolderSyncState, string][] = [
      ["uidValidity", "uid_validity"], ["uidNext", "uid_next"], ["highestModseq", "highest_modseq"],
      ["syncedMinUid", "synced_min_uid"], ["lastSyncAt", "last_sync_at"],
    ];
    const sets: string[] = [];
    const params: (number | string | null)[] = [];
    for (const [key, column] of map) {
      if (patch[key] === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(patch[key] as number | string | null);
    }
    if (sets.length) this.q.run(`UPDATE folders SET ${sets.join(", ")} WHERE id = ?`, ...params, folderId);
  }

  /** UIDVALIDITY changed: drop every message whose UID lives in this folder and clear the sync window. Returns affected thread ids. */
  resetFolder(folderId: FolderId): number[] {
    const ids = this.q.all<{ id: number }>("SELECT id FROM messages WHERE folder_id = ?", folderId).map((r) => r.id);
    const threads = deleteMessages(this.q, ids);
    this.q.run("UPDATE folders SET uid_validity = NULL, uid_next = NULL, highest_modseq = NULL, synced_min_uid = NULL, last_sync_at = NULL WHERE id = ?", folderId);
    return threads;
  }
}

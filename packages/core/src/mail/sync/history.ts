import type { SearchObject } from "imapflow";
import type { Folder } from "../../types";
import { chunks, ingestUids, search, BATCH_SIZE, type FolderSyncDeps } from "./folderSync";

/** UIDs fetched per loadOlder call and folder. */
export const BACKFILL_BATCH = 500;
/** Messages a server search brings in per folder, newest first. */
export const SERVER_SEARCH_CAP = 200;

export type BackfillResult = { loaded: number; hasMore: boolean };

/**
 * Fetches the next older batch of a folder below the lowest UID synced so far. Rules and blocked senders are not
 * evaluated on history. The caller holds the mailbox lock. `syncedMinUid` drops to the oldest UID fetched; when nothing
 * older is left it becomes 1, which is how the UI learns the folder is complete.
 */
export async function backfillFolder(d: FolderSyncDeps, folder: Folder, batch: number = BACKFILL_BATCH): Promise<BackfillResult> {
  const state = d.store.getFolderSyncState(folder.id);
  if (state.uidNext === null || state.syncedMinUid === null) return { loaded: 0, hasMore: false };
  const min = state.syncedMinUid;
  if (min <= 1) return { loaded: 0, hasMore: false };
  const local = new Set(d.store.listLocalUids(folder.id));
  const older = (await search(d.client, { uid: `1:${min - 1}` })).filter((u) => u < min).sort((a, b) => b - a);
  if (older.length === 0) {
    d.store.setFolderSyncState(folder.id, { syncedMinUid: 1 });
    return { loaded: 0, hasMore: false };
  }
  const take = older.slice(0, batch);
  const fresh = take.filter((u) => !local.has(u));
  let loaded = 0;
  for (const part of chunks(fresh, BATCH_SIZE)) {
    await ingestUids(d, folder, part, false);
    loaded += part.length;
    d.progress({ done: loaded, total: fresh.length, folder: folder.name });
  }
  const oldest = take[take.length - 1]!;
  const rest = older.length - take.length;
  d.store.setFolderSyncState(folder.id, { syncedMinUid: rest > 0 ? oldest : 1 });
  return { loaded, hasMore: rest > 0 };
}

/**
 * Runs a server-side search in one folder and ingests the matches that are not local yet (newest first, capped).
 * Returns how many messages the server matched and how many were new here. The caller holds the mailbox lock.
 */
export async function searchFolder(d: FolderSyncDeps, folder: Folder, criteria: SearchObject, cap: number = SERVER_SEARCH_CAP): Promise<{ found: number; added: number }> {
  const found = await search(d.client, criteria);
  const local = new Set(d.store.listLocalUids(folder.id));
  const fresh = found.filter((u) => !local.has(u)).sort((a, b) => b - a).slice(0, cap);
  for (const part of chunks(fresh, BATCH_SIZE)) await ingestUids(d, folder, part, false);
  return { found: found.length, added: fresh.length };
}

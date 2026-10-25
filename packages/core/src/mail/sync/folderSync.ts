import type { FetchMessageObject, FetchQueryObject, ImapFlow, MailboxObject, MessageStructureObject } from "imapflow";
import { logger } from "../../log";
import type { Store } from "../../store";
import type { IngestMessage, IngestOutcome } from "../../store/types";
import type { AccountId, Folder, SyncStatus } from "../../types";
import { FETCH_HEADERS } from "./headers";
import { flagsOf, toIngestMessage } from "./mapping";

const log = logger("mail.sync");
const DAY = 24 * 60 * 60 * 1000;
export const BATCH_SIZE = 200;
const CHUNK = 500;

/** One ingested batch, handed to the account sync for follow-up work once the mailbox lock is released. */
export type Batch = {
  folder: Folder;
  items: IngestMessage[];
  outcomes: IngestOutcome[];
  structures: Map<number, MessageStructureObject>;
  /** Rules and blocked senders were evaluated; false for history backfill. */
  evaluated: boolean;
};

export type FolderSyncDeps = {
  store: Store;
  accountId: AccountId;
  client: ImapFlow;
  gmail: boolean;
  labelPaths: (labels: Set<string>) => string[];
  now: () => number;
  initialDays: () => number;
  collect: (batch: Batch) => void;
  changed: (threadIds: number[]) => void;
  progress: (p: NonNullable<SyncStatus["progress"]>) => void;
};

const envelopeQuery = (gmail: boolean): FetchQueryObject => ({
  uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true, size: true,
  headers: [...FETCH_HEADERS], ...(gmail ? { labels: true, threadId: true } : {}),
});

export const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export async function search(client: ImapFlow, query: Parameters<ImapFlow["search"]>[0]): Promise<number[]> {
  const found = await client.search(query, { uid: true });
  return Array.isArray(found) ? found : [];
}

export async function ingestUids(d: FolderSyncDeps, folder: Folder, uids: number[], evaluate: boolean): Promise<void> {
  const fetched = await d.client.fetchAll(uids.join(","), envelopeQuery(d.gmail), { uid: true });
  fetched.sort((a, b) => a.uid - b.uid);
  const wanted = new Set(uids);
  const msgs = fetched.filter((m: FetchMessageObject) => wanted.has(m.uid));
  if (msgs.length === 0) return;
  const now = d.now();
  const items = msgs.map((m) => toIngestMessage(m, { gmail: d.gmail, labelPaths: d.labelPaths, now }));
  const outcomes = d.store.ingestMessages(d.accountId, folder.id, items, { now, evaluate });
  const structures = new Map<number, MessageStructureObject>();
  for (const m of msgs) if (m.bodyStructure) structures.set(m.uid, m.bodyStructure);
  d.changed([...new Set(outcomes.flatMap((o) => [o.threadId, ...o.mergedThreadIds]))]);
  d.collect({ folder, items, outcomes, structures, evaluated: evaluate });
}

async function initialSync(d: FolderSyncDeps, folder: Folder, mb: MailboxObject): Promise<void> {
  const days = d.initialDays();
  const found = await search(d.client, days > 0 ? { since: new Date(d.now() - days * DAY) } : { all: true });
  const local = new Set(d.store.listLocalUids(folder.id));
  const uids = found.filter((u) => !local.has(u)).sort((a, b) => b - a); // newest first
  let done = 0;
  let minUid: number | null = null;
  for (const batch of chunks(uids, BATCH_SIZE)) {
    await ingestUids(d, folder, batch, false);
    done += batch.length;
    minUid = Math.min(minUid ?? Infinity, ...batch);
    d.store.setFolderSyncState(folder.id, { syncedMinUid: minUid });
    d.progress({ done, total: uids.length, folder: folder.name });
  }
  d.store.setFolderSyncState(folder.id, {
    uidValidity: Number(mb.uidValidity), uidNext: mb.uidNext, highestModseq: mb.highestModseq?.toString() ?? null,
    syncedMinUid: minUid ?? (d.store.getFolderSyncState(folder.id).syncedMinUid ?? mb.uidNext), lastSyncAt: d.now(),
  });
}

async function syncFlags(d: FolderSyncDeps, folder: Folder, mb: MailboxObject, highestModseq: string | null, syncedMinUid: number | null): Promise<void> {
  const query: FetchQueryObject = { uid: true, flags: true, ...(d.gmail ? { labels: true } : {}) };
  let rows: FetchMessageObject[] = [];
  if (highestModseq !== null && mb.highestModseq !== undefined && !mb.noModseq) {
    if (BigInt(highestModseq) >= mb.highestModseq) return;
    rows = await d.client.fetchAll("1:*", query, { uid: true, changedSince: BigInt(highestModseq) });
  } else {
    const local = d.store.listLocalUids(folder.id, syncedMinUid ?? 0);
    for (const part of chunks(local, CHUNK)) rows.push(...(await d.client.fetchAll(part.join(","), query, { uid: true })));
  }
  if (rows.length === 0) return;
  const changed = new Set<number>(d.store.applyFlags(folder.id, rows.map((r) => ({ uid: r.uid, ...flagsOf(r.flags) }))));
  if (d.gmail) {
    const labelled = rows.filter((r) => r.labels).map((r) => ({ uid: r.uid, labels: d.labelPaths(r.labels!) }));
    for (const id of d.store.applyGmailLabels(folder.id, labelled)) changed.add(id);
  }
  d.changed([...changed]);
}

async function incrementalSync(d: FolderSyncDeps, folder: Folder, mb: MailboxObject, uidNext: number, highestModseq: string | null, syncedMinUid: number | null): Promise<void> {
  if (mb.uidNext > uidNext) {
    const fresh = (await search(d.client, { uid: `${uidNext}:*` })).filter((u) => u >= uidNext).sort((a, b) => a - b);
    for (const batch of chunks(fresh, BATCH_SIZE)) await ingestUids(d, folder, batch, true);
  }
  await syncFlags(d, folder, mb, highestModseq, syncedMinUid);
  d.store.setFolderSyncState(folder.id, { uidNext: mb.uidNext, highestModseq: mb.highestModseq?.toString() ?? null, lastSyncAt: d.now() });
}

/**
 * Brings one folder up to date: initial window, new mail, flag changes. The caller holds the mailbox lock.
 * A changed UIDVALIDITY drops the folder's messages and starts over.
 */
export async function syncFolder(d: FolderSyncDeps, folder: Folder): Promise<void> {
  const mb = d.client.mailbox;
  if (!mb) throw new Error("No mailbox is selected.");
  let state = d.store.getFolderSyncState(folder.id);
  if (state.uidValidity !== null && state.uidValidity !== Number(mb.uidValidity)) {
    log.info("uid validity changed, resyncing folder", { folder: folder.path });
    d.changed(d.store.resetFolder(folder.id));
    state = d.store.getFolderSyncState(folder.id);
  }
  if (state.uidNext === null) await initialSync(d, folder, mb);
  else await incrementalSync(d, folder, mb, state.uidNext, state.highestModseq, state.syncedMinUid);
}

/** Removes local messages whose UID no longer exists on the server (within the synced window). Lock held by the caller. */
export async function reconcileExpunges(d: Pick<FolderSyncDeps, "store" | "client" | "changed">, folder: Folder): Promise<void> {
  const state = d.store.getFolderSyncState(folder.id);
  if (state.uidNext === null) return;
  const min = state.syncedMinUid ?? 1;
  const found = await d.client.search({ uid: `${min}:*` }, { uid: true });
  if (!Array.isArray(found)) return;
  const remote = new Set(found);
  const gone = d.store.listLocalUids(folder.id, min).filter((u) => !remote.has(u));
  if (gone.length) d.changed(d.store.removeUids(folder.id, gone));
}

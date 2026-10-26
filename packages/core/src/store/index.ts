import { tx, type Db } from "../db/open";
import { AccountsRepo } from "./accounts";
import { ContactsRepo } from "./contacts";
import { DashboardRepo } from "./dashboard";
import { DraftsRepo, ScheduledRepo } from "./drafts";
import { FoldersRepo } from "./folders";
import { IngestRepo } from "./ingest";
import { InvitesRepo } from "./invites";
import { ensureIndexes } from "./indexes";
import { ActivityRepo, KvRepo } from "./kv";
import { LibraryRepo, RemindersRepo } from "./library";
import { MessagesRepo } from "./messages";
import { PendingOpsRepo } from "./pendingOps";
import { RecategorizeRepo } from "./recategorize";
import { ReceiptsRepo } from "./receipts";
import { RulesRepo } from "./rulesRepo";
import { SettingsRepo } from "./settings";
import { Sql } from "./sql";
import { ThreadActionsRepo } from "./threadActions";
import { ThreadListRepo } from "./threadList";

/** Flat view of every repository's methods, so callers write store.ingestMessages(...), store.listThreads(...). */
type Pub<T> = { [K in keyof T]: T[K] };
export interface Store extends
  Pub<AccountsRepo>, Pub<FoldersRepo>, Pub<ContactsRepo>, Pub<RulesRepo>, Pub<ReceiptsRepo>, Pub<IngestRepo>, Pub<MessagesRepo>,
  Pub<ThreadListRepo>, Pub<ThreadActionsRepo>, Pub<SettingsRepo>, Pub<KvRepo>, Pub<ActivityRepo>, Pub<DraftsRepo>, Pub<ScheduledRepo>,
  Pub<LibraryRepo>, Pub<RemindersRepo>, Pub<DashboardRepo>, Pub<RecategorizeRepo>, Pub<PendingOpsRepo>, Pub<InvitesRepo> {}

/**
 * The data layer. Synchronous (node:sqlite) and the only place SQL lives besides the schema.
 * Construct with a Db from openDb(); the constructor creates the extra indexes in indexes.ts.
 */
export class Store {
  readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    ensureIndexes(db);
    const q = new Sql(db);
    const accounts = new AccountsRepo(q);
    const folders = new FoldersRepo(q);
    const contacts = new ContactsRepo(q);
    const rules = new RulesRepo(q);
    const receipts = new ReceiptsRepo(q);
    const messages = new MessagesRepo(q, accounts);
    const lists = new ThreadListRepo(q, accounts, receipts, rules);
    const repos: object[] = [
      accounts, folders, contacts, rules, receipts, messages, lists,
      new IngestRepo(q, accounts, folders, contacts, rules, receipts),
      new ThreadActionsRepo(q, accounts, folders, messages),
      new SettingsRepo(q), new KvRepo(q), new ActivityRepo(q), new DraftsRepo(q), new ScheduledRepo(q),
      new LibraryRepo(q), new RemindersRepo(q, accounts), new RecategorizeRepo(q), new PendingOpsRepo(q), new InvitesRepo(q),
      new DashboardRepo(q, accounts, folders, lists, receipts, rules),
    ];
    for (const repo of repos) {
      for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(repo))) {
        const fn = (repo as Record<string, unknown>)[name];
        if (name === "constructor" || typeof fn !== "function") continue;
        if (Object.prototype.hasOwnProperty.call(this, name)) throw new Error(`Store method clash: ${name}`);
        Object.defineProperty(this, name, { value: fn.bind(repo), enumerable: false });
      }
    }
  }

  /** Runs fn in one transaction (joins an outer one). */
  transaction<T>(fn: () => T): T {
    return tx(this.db, fn);
  }
}

export { DEFAULT_SETTINGS, settingsSchema } from "./settings";
export { INDEX_STATEMENTS, ensureIndexes } from "./indexes";
export { parseUnsubscribe } from "./unsubscribe";
export { isPossiblyForwarded, recipientStatus, summarize as summarizeRecipients } from "./receiptStatus";
export { encodeCursor, decodeCursor } from "./threadList";
export { htmlToPlain, bodyTextFor } from "./fts";
export type * from "./types";
export type { NewAccount, AccountPatch } from "./accounts";
export type { FolderInput } from "./folders";
export type { NewDraft, DraftUpdate, DraftMeta, ScheduledSendRow } from "./drafts";
export type { CalendarAttachment } from "./invites";
export type { PendingKind, PendingOp, PendingOpSpec } from "./pendingOps";
export type { NewTracked, ReceiptEventInput } from "./receipts";
export type { SidebarAccountData, SidebarCounts } from "./dashboard";
export * from "../categorize";
export * from "../rules";
export * from "../search";
export * from "../threading";

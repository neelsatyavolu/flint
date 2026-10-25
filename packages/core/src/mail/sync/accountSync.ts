import type { ImapFlow, SearchObject } from "imapflow";
import { logger } from "../../log";
import type { Store } from "../../store";
import { FlintError, type Account, type AccountId, type Folder, type FlintEvent, type MailboxRole, type SyncStatus, type ThreadId } from "../../types";
import { ServerActions } from "../actions";
import { createImapClient, describeConnectError, type MailAuth } from "../connect";
import { withMailbox, type ImapRunner } from "../runner";
import { attachmentPath, downloadPart, readCached, writeCached } from "./attachments";
import { loadBody } from "./body";
import { chunks, reconcileExpunges, syncFolder, type Batch, type FolderSyncDeps } from "./folderSync";
import { FETCH_HEADERS, parseHeaders } from "./headers";
import { classifyMailboxes, gmailLabelPaths } from "./folders";
import { backfillFolder, searchFolder, type BackfillResult } from "./history";
import { buildGmailRaw, buildImapCriteria, inTargets, type ParsedSearch } from "../../search";
import { applyOutcomeActions, newMailEvents } from "./outcomes";

const log = logger("mail.sync");
const DAY = 24 * 60 * 60 * 1000;

export type AccountSyncOptions = {
  store: Store;
  accountId: AccountId;
  getAuth: () => Promise<MailAuth>;
  emit: (event: FlintEvent) => void;
  dataDir: string;
  now?: () => number;
  createClient?: (account: Account, auth: MailAuth) => ImapFlow;
  /** Poll interval when IDLE is not available. */
  pollMs?: number;
  /** Poll interval as a safety net while IDLE is active. */
  idlePollMs?: number;
  backoff?: { minMs: number; maxMs: number };
};

const ROLE_ORDER: MailboxRole[] = ["inbox", "drafts", "sent", "archive", "spam", "trash"];
const GENERIC_ROLES = new Set<MailboxRole>(ROLE_ORDER);
const GMAIL_SYNC_ROLES: MailboxRole[] = ["trash", "spam", "all"]; // All Mail last: label and location changes settle first

const isAuthError = (e: unknown): boolean => e instanceof FlintError && e.code === "auth";
const isNetworkError = (e: unknown): boolean => e instanceof FlintError && e.code === "network";

/** Consecutive auth failures tolerated before the account is marked as needing a new sign-in. */
const AUTH_RETRIES = 2;
/** Messages whose bodies are prefetched per mailbox lock. */
const PREFETCH_CHUNK = 5;

/**
 * Keeps one account's local store in step with its IMAP server: initial and incremental sync, IDLE,
 * reconnect with backoff, on-demand bodies and attachments. Also the account's ImapRunner for server actions.
 */
export class AccountSync implements ImapRunner {
  readonly #o: AccountSyncOptions;
  readonly #now: () => number;
  #status: SyncStatus;
  #client: ImapFlow | null = null;
  #connecting: Promise<ImapFlow> | null = null;
  #idleClient: ImapFlow | null = null;
  #stopped = true;
  #loop: Promise<void> | null = null;
  #wakeResolve: (() => void) | null = null;
  #pendingWake = false;
  #cycle: Promise<void> = Promise.resolve();
  #lastExists = new Map<number, number>();
  #cycles = 0;
  readonly actions: ServerActions;

  constructor(options: AccountSyncOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#status = { accountId: options.accountId, state: "idle" };
    this.actions = new ServerActions(options.store, options.accountId, this);
  }

  status(): SyncStatus {
    return this.#status;
  }

  /** Starts the sync loop. Returns at once; progress arrives as sync events. */
  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#loop = this.#runLoop();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#wake();
    this.#closeClients();
    await this.#loop?.catch(() => undefined);
    this.#loop = null;
  }

  /** Runs one full sync cycle now and resolves when it finishes. Rejects with the sync error. */
  syncNow(): Promise<void> {
    const next = this.#cycle.catch(() => undefined).then(() => this.#syncCycle());
    this.#cycle = next;
    return next;
  }

  /** Syncs one folder on demand, such as a user folder opened for the first time. It stays in the sync set afterwards. */
  async syncFolderNow(folderId: number): Promise<void> {
    const folder = this.#o.store.requireFolder(folderId);
    const client = await this.#ensureClient();
    const gmail = this.#isGmail(client);
    await this.#syncOneFolder(client, folder, gmail);
  }

  /**
   * Fetches the next batch of older mail for these folders (history below what was synced). Resolves with how many
   * messages arrived and whether any folder still has older mail on the server.
   */
  async loadOlder(folderIds: number[], batch?: number): Promise<BackfillResult> {
    const client = await this.#ensureClient();
    const gmail = this.#gmailMode(client);
    const pending: Batch[] = [];
    const total: BackfillResult = { loaded: 0, hasMore: false };
    for (const id of folderIds) {
      const folder = this.#o.store.requireFolder(id);
      const r = await this.#withFolderLock(client, folder, gmail, pending, (d, f) => backfillFolder(d, f, batch));
      total.loaded += r.loaded;
      total.hasMore = total.hasMore || r.hasMore;
    }
    await this.#afterBatches(pending, gmail);
    return total;
  }

  /**
   * Asks the server to search for a parsed query and ingests matching messages that are not local yet. Gmail gets
   * X-GM-RAW; other servers get IMAP criteria in the folders the query points at.
   */
  async searchServer(parsed: ParsedSearch): Promise<{ found: number; added: number }> {
    const { store } = this.#o;
    const client = await this.#ensureClient();
    const gmail = this.#gmailMode(client);
    const pending: Batch[] = [];
    const total = { found: 0, added: 0 };
    const plan = gmail ? this.#gmailSearchPlan(parsed) : this.#imapSearchPlan(parsed);
    for (const { folder, criteria } of plan) {
      const r = await this.#withFolderLock(client, store.requireFolder(folder.id), gmail, pending, (d, f) => searchFolder(d, f, criteria));
      total.found += r.found;
      total.added += r.added;
    }
    await this.#afterBatches(pending, gmail);
    return total;
  }

  #gmailMode(client: ImapFlow): boolean {
    const { store, accountId } = this.#o;
    return this.#isGmail(client) && store.getFolderByRole(accountId, "all") !== null;
  }

  #gmailSearchPlan(parsed: ParsedSearch): { folder: Folder; criteria: SearchObject }[] {
    const { store, accountId } = this.#o;
    const raw = buildGmailRaw(parsed);
    if (!raw) return [];
    const wants = inTargets(parsed).roles;
    const role: MailboxRole = wants.includes("trash") ? "trash" : wants.includes("spam") ? "spam" : "all";
    const folder = store.getFolderByRole(accountId, role);
    return folder ? [{ folder, criteria: { gmraw: raw } }] : [];
  }

  #imapSearchPlan(parsed: ParsedSearch): { folder: Folder; criteria: SearchObject }[] {
    const { store, accountId } = this.#o;
    const criteria = buildImapCriteria(parsed);
    if (!criteria) return [];
    const { roles, names } = inTargets(parsed);
    const synced = store.listFolders(accountId).filter((f) => store.getFolderSyncState(f.id).uidNext !== null);
    const picked = roles.length || names.length
      ? synced.filter((f) => (f.role !== null && roles.includes(f.role)) || names.includes(f.name.toLowerCase()))
      : synced.filter((f) => f.role === "inbox" || f.role === "sent" || f.role === "archive" || f.role === null);
    return picked.map((folder) => ({ folder, criteria }));
  }

  async #withFolderLock<T>(client: ImapFlow, folder: Folder, gmail: boolean, pending: Batch[], fn: (d: FolderSyncDeps, f: Folder) => Promise<T>): Promise<T> {
    const { store, accountId } = this.#o;
    const deps: FolderSyncDeps = {
      store, accountId, client, gmail, now: this.#now,
      labelPaths: (labels) => gmailLabelPaths(labels, (role) => store.getFolderByRole(accountId, role)?.path ?? null),
      initialDays: () => store.getSettings().sync.initialDays,
      collect: (b) => pending.push(b),
      changed: (ids) => this.#emitChanged(ids),
      progress: () => undefined,
    };
    const lock = await client.getMailboxLock(folder.path, { readOnly: true });
    try {
      return await fn(deps, folder);
    } finally {
      lock.release();
    }
  }

  async run<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    return fn(await this.#ensureClient());
  }

  /**
   * Re-fetches the categorization headers (FETCH_HEADERS) for stored messages and merges them in. Older syncs
   * stored fewer headers; this lets a newer categorizer see the same signals new mail has. Returns messages updated.
   */
  async refreshHeaders(targets: { folderId: number; folderPath: string; uids: number[] }[]): Promise<number> {
    let updated = 0;
    for (const t of targets) {
      for (const part of chunks(t.uids, 200)) {
        const fetched = await this.run((c) => withMailbox(c, t.folderPath, () => c.fetchAll(part.join(","), { uid: true, headers: [...FETCH_HEADERS] }, { uid: true }), true));
        const items = fetched.map((m) => {
          const { references: _refs, ...selected } = parseHeaders(m.headers);
          return { uid: m.uid, headers: selected };
        });
        updated += this.#o.store.mergeHeaders(t.folderId, items);
      }
    }
    return updated;
  }

  // ---------- bodies and attachments ----------

  /** Downloads and stores the text and html of a message. No-op when the body is already stored. */
  async fetchBody(messageRowId: number): Promise<void> {
    const { store } = this.#o;
    const msg = store.getMessage(messageRowId);
    if (!msg) throw new FlintError("not_found", "That message no longer exists.");
    if (msg.bodyLoaded) return;
    const loc = store.getMessageLocations([messageRowId])[0];
    if (!loc) throw new FlintError("not_found", "That message no longer exists.");
    const body = await this.run((c) => withMailbox(c, loc.folderPath, () => loadBody(c, loc.uid), true));
    if (!body) throw new FlintError("not_found", "That message is no longer on the server.");
    store.setBody(messageRowId, { text: body.text, html: body.html });
    this.#emitChanged([loc.threadId]);
  }

  /** The attachment's bytes. Downloaded once, then served from dataDir/attachments. */
  async fetchAttachment(attachmentId: number): Promise<Buffer> {
    const { store, dataDir } = this.#o;
    const att = store.getAttachment(attachmentId);
    if (!att) throw new FlintError("not_found", "That attachment no longer exists.");
    const cached = await readCached(att.cachedPath);
    if (cached) return cached;
    const loc = store.getMessageLocations([att.messageRowId])[0];
    if (!loc) throw new FlintError("not_found", "That message no longer exists.");
    const data = await this.run((c) => withMailbox(c, loc.folderPath, () => downloadPart(c, loc.uid, att.part), true));
    const path = attachmentPath(dataDir, loc.accountId, att.messageRowId, att.id, att.filename);
    await writeCached(path, data);
    store.setAttachmentCachedPath(att.id, path);
    return data;
  }

  // ---------- loop ----------

  #setStatus(patch: Partial<SyncStatus>): void {
    const next: SyncStatus = { ...this.#status, ...patch };
    if (patch.error === undefined && "error" in patch) delete next.error;
    if (patch.progress === undefined && "progress" in patch) delete next.progress;
    this.#status = next;
    this.#o.emit({ type: "sync", status: next });
  }

  #wake(): void {
    if (this.#wakeResolve) {
      const r = this.#wakeResolve;
      this.#wakeResolve = null;
      r();
    } else {
      this.#pendingWake = true;
    }
  }

  #sleepUntilWake(ms: number): Promise<void> {
    if (this.#pendingWake || this.#stopped) {
      this.#pendingWake = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.#wakeResolve = null; resolve(); }, ms);
      this.#wakeResolve = () => { clearTimeout(timer); resolve(); };
    });
  }

  async #runLoop(): Promise<void> {
    const backoff = this.#o.backoff ?? { minMs: 5000, maxMs: 5 * 60 * 1000 };
    let delay = backoff.minMs;
    let authFailures = 0;
    while (!this.#stopped) {
      try {
        await this.syncNow();
        delay = backoff.minMs;
        authFailures = 0;
        await this.#startIdle();
        await this.#sleepUntilWake(this.#idleClient ? (this.#o.idlePollMs ?? 10 * 60 * 1000) : (this.#o.pollMs ?? 2 * 60 * 1000));
      } catch (error) {
        if (this.#stopped) break;
        this.#closeClients();
        // A rejected login may be a transient refusal (Gmail connection limits, a Google 5xx), so retry a couple of
        // times with backoff before telling the user to sign in again.
        if (isAuthError(error) && ++authFailures <= AUTH_RETRIES) {
          log.warn("sign-in rejected, retrying", { account: this.#o.accountId, attempt: authFailures, reason: (error as Error).message });
          this.#setStatus({ state: "error", error: (error as Error).message, progress: undefined });
          await this.#sleepUntilWake(delay);
          delay = Math.min(delay * 2, backoff.maxMs);
          continue;
        }
        if (isAuthError(error)) {
          log.warn("sign-in rejected", { account: this.#o.accountId, reason: (error as Error).message });
          this.#setStatus({ state: "auth_error", error: "Sign in again.", progress: undefined });
          return;
        }
        const offline = isNetworkError(error) || ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "NoConnection"].includes((error as { code?: string }).code ?? "");
        this.#setStatus({ state: offline ? "offline" : "error", error: (error as Error).message, progress: undefined });
        log.warn("sync failed", { account: this.#o.accountId, reason: (error as Error).message });
        await this.#sleepUntilWake(delay);
        delay = Math.min(delay * 2, backoff.maxMs);
      }
    }
  }

  // ---------- connections ----------

  async #ensureClient(): Promise<ImapFlow> {
    if (this.#client?.usable) return this.#client;
    if (this.#connecting) return this.#connecting;
    this.#connecting = this.#connect().finally(() => { this.#connecting = null; });
    return this.#connecting;
  }

  async #open(): Promise<ImapFlow> {
    const account = this.#o.store.requireAccount(this.#o.accountId);
    const auth = await this.#o.getAuth();
    const client = (this.#o.createClient ?? ((a, au) => createImapClient(a, au)))(account, auth);
    client.on("error", (e: Error) => log.warn("imap error", { account: account.id, reason: e.message }));
    try {
      await client.connect();
    } catch (error) {
      client.close();
      throw describeConnectError(error, "IMAP", account.imapHost);
    }
    this.#adoptGmailProvider(account, client);
    return client;
  }

  /**
   * A server that advertises X-GM-EXT-1 is Gmail (Workspace, a custom domain, an IMAP account added by hand). Mark the
   * account so label-aware sync is used. Only before any mail is stored: switching later would re-ingest everything.
   */
  #adoptGmailProvider(account: Account, client: ImapFlow): void {
    const { store, accountId } = this.#o;
    if (account.provider === "gmail" || !client.capabilities.has("X-GM-EXT-1") || store.accountHasMessages(accountId)) return;
    store.updateAccount(accountId, { provider: "gmail" });
    log.info("server is Gmail, using label-aware sync", { account: accountId });
  }

  async #connect(): Promise<ImapFlow> {
    const client = await this.#open();
    client.on("close", () => {
      if (this.#client === client) {
        this.#client = null;
        if (!this.#stopped) this.#wake();
      }
    });
    this.#client = client;
    return client;
  }

  async #startIdle(): Promise<void> {
    if (this.#idleClient?.usable) return;
    this.#idleClient = null;
    let client: ImapFlow;
    try {
      client = await this.#open();
    } catch (error) {
      log.warn("idle connection failed", { reason: (error as Error).message });
      return;
    }
    if (!client.capabilities.has("IDLE")) {
      await client.logout().catch(() => client.close());
      return;
    }
    try {
      await client.mailboxOpen("INBOX", { readOnly: true });
    } catch (error) {
      log.warn("idle could not open the inbox", { reason: (error as Error).message });
      client.close();
      return;
    }
    const wake = () => this.#wake();
    client.on("exists", wake);
    client.on("expunge", wake);
    client.on("flags", wake);
    client.on("close", () => {
      if (this.#idleClient === client) {
        this.#idleClient = null;
        if (!this.#stopped) this.#wake();
      }
    });
    this.#idleClient = client;
    void (async () => {
      try {
        while (!this.#stopped && this.#idleClient === client && client.usable) await client.idle();
      } catch (error) {
        log.debug("idle ended", { reason: (error as Error).message });
      }
    })();
  }

  #closeClients(): void {
    for (const c of [this.#client, this.#idleClient]) {
      if (!c) continue;
      c.logout().catch(() => c.close());
    }
    this.#client = null;
    this.#idleClient = null;
  }

  // ---------- cycle ----------

  #isGmail(client: ImapFlow): boolean {
    return this.#o.store.requireAccount(this.#o.accountId).provider === "gmail" && client.capabilities.has("X-GM-EXT-1");
  }

  #emitChanged(threadIds: ThreadId[]): void {
    if (threadIds.length) this.#o.emit({ type: "mail_changed", accountId: this.#o.accountId, threadIds: [...new Set(threadIds)] });
  }

  #discoverFolders(list: Awaited<ReturnType<ImapFlow["list"]>>): Folder[] {
    const { store, accountId } = this.#o;
    return classifyMailboxes(list).map((e) => store.upsertFolder(accountId, { path: e.path, name: e.name, delimiter: e.delimiter, role: e.role, specialUse: e.specialUse }));
  }

  #targets(folders: Folder[], gmail: boolean): Folder[] {
    if (gmail) {
      const byRole = new Map(folders.filter((f) => f.role).map((f) => [f.role!, f] as const));
      return GMAIL_SYNC_ROLES.map((r) => byRole.get(r)).filter((f): f is Folder => Boolean(f));
    }
    const picked = new Map<MailboxRole, Folder>();
    for (const f of folders) if (f.role && GENERIC_ROLES.has(f.role) && !picked.has(f.role)) picked.set(f.role, f);
    const ordered = ROLE_ORDER.map((r) => picked.get(r)).filter((f): f is Folder => Boolean(f));
    const extra = folders.filter((f) => !f.role && this.#o.store.getFolderSyncState(f.id).uidValidity !== null);
    return [...ordered, ...extra];
  }

  async #syncCycle(): Promise<void> {
    const client = await this.#ensureClient();
    this.#setStatus({ state: "syncing", error: undefined });
    const folders = this.#discoverFolders(await client.list());
    // Gmail sync reads All Mail. When the user hides it from IMAP there is nothing to read the inbox from, so fall
    // back to the generic folder set (INBOX, Sent, ...) instead of syncing an empty mailbox without any error.
    const gmail = this.#isGmail(client) && folders.some((f) => f.role === "all");
    if (this.#isGmail(client) && !gmail) log.warn("Gmail hides All Mail from IMAP; syncing folders directly", { account: this.#o.accountId });
    const targets = this.#targets(folders, gmail);
    const pending: Batch[] = [];
    try {
      for (const folder of targets) await this.#syncOneFolder(client, folder, gmail, pending);
      this.#cycles += 1;
      for (const folder of targets) await this.#reconcile(client, folder);
    } catch (error) {
      // A dropped connection mid-sync must not lose the follow-up work for batches that were already ingested
      // (their rows exist, so a retry would not collect them again).
      await this.#afterBatches(pending, gmail).catch((e: Error) => log.warn("follow-up after interrupted sync failed", { reason: e.message }));
      throw error;
    }
    await this.#afterBatches(pending, gmail);
    this.#setStatus({ state: "idle", error: undefined, progress: undefined, lastSyncAt: this.#now() });
  }

  async #syncOneFolder(client: ImapFlow, folder: Folder, gmail: boolean, sink?: Batch[]): Promise<void> {
    const { store, accountId } = this.#o;
    const pending: Batch[] = sink ?? [];
    const deps: FolderSyncDeps = {
      store, accountId, client, gmail, now: this.#now,
      labelPaths: (labels) => gmailLabelPaths(labels, (role) => store.getFolderByRole(accountId, role)?.path ?? null),
      initialDays: () => store.getSettings().sync.initialDays,
      collect: (b) => pending.push(b),
      changed: (ids) => this.#emitChanged(ids),
      progress: (progress) => this.#setStatus({ state: "syncing", progress }),
    };
    const lock = await client.getMailboxLock(folder.path);
    try {
      await syncFolder(deps, store.requireFolder(folder.id));
    } finally {
      lock.release();
    }
    if (!sink) await this.#afterBatches(pending, gmail);
  }

  async #reconcile(client: ImapFlow, folder: Folder): Promise<void> {
    const lock = await client.getMailboxLock(folder.path, { readOnly: true });
    try {
      const exists = client.mailbox ? client.mailbox.exists : 0;
      const periodic = this.#cycles % 15 === 0;
      if (!periodic && this.#lastExists.get(folder.id) === exists) return;
      await reconcileExpunges({ store: this.#o.store, client, changed: (ids) => this.#emitChanged(ids) }, folder);
      this.#lastExists.set(folder.id, exists);
    } finally {
      lock.release();
    }
  }

  /** Work that talks to the server again (rule actions, body prefetch) runs after the mailbox lock is released. */
  async #afterBatches(batches: Batch[], gmail: boolean): Promise<void> {
    const { store, accountId, emit } = this.#o;
    const inboxPath = store.getFolderByRole(accountId, "inbox")?.path ?? null;
    const windowMs = store.getSettings().sync.bodiesForRecentDays * DAY;
    for (const batch of batches) {
      await this.#prefetchBodies(batch, gmail, inboxPath, windowMs);
      if (batch.evaluated) {
        const touched = await applyOutcomeActions({ store, accountId, actions: this.actions, emit }, batch.outcomes);
        this.#emitChanged(touched);
        for (const event of newMailEvents({ store, accountId }, batch, inboxPath)) emit(event);
      }
    }
  }

  async #prefetchBodies(batch: Batch, gmail: boolean, inboxPath: string | null, windowMs: number): Promise<void> {
    const cutoff = this.#now() - windowMs;
    const byUid = new Map(batch.items.map((i) => [i.uid, i]));
    const wanted = batch.outcomes.filter((o) => {
      const item = byUid.get(o.uid);
      if (!item || item.date < cutoff) return false;
      return gmail ? Boolean(item.gmLabels && inboxPath && item.gmLabels.includes(inboxPath)) : batch.folder.role === "inbox";
    });
    if (wanted.length === 0) return;
    // Small chunks, each under its own mailbox lock, so thread opens, attachment downloads and server actions
    // queued on the same connection are served between chunks instead of waiting for the whole batch.
    for (let i = 0; i < wanted.length; i += PREFETCH_CHUNK) {
      const chunk = wanted.slice(i, i + PREFETCH_CHUNK);
      try {
        await this.run((c) => withMailbox(c, batch.folder.path, async () => {
          const changed: ThreadId[] = [];
          for (const o of chunk) {
            try {
              const body = await loadBody(c, o.uid, batch.structures.get(o.uid));
              if (!body) continue;
              this.#o.store.setBody(o.messageRowId, { text: body.text, html: body.html });
              changed.push(o.threadId);
            } catch (error) {
              log.debug("body prefetch skipped a message", { reason: (error as Error).message });
            }
          }
          this.#emitChanged(changed);
        }, true));
      } catch (error) {
        log.warn("body prefetch failed", { reason: (error as Error).message });
        return;
      }
    }
  }
}

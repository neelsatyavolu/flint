import { logger } from "../log";
import type { Platform } from "../platform";
import { resolveAuth, type GoogleClient } from "../mail/connect";
import { AccountSync, type AccountSyncOptions } from "../mail/sync/accountSync";
import type { Store } from "../store";
import type { AccountId, FlintEvent, Settings, SyncStatus } from "../types";

const log = logger("service.sync");

export type SyncTuning = Pick<AccountSyncOptions, "pollMs" | "idlePollMs" | "backoff">;

export type SyncManagerDeps = {
  store: Store;
  platform: Platform;
  getSettings: () => Settings;
  /** The Google OAuth client (id from settings, secret from the secret store). Defaults to settings. */
  googleClient?: () => GoogleClient | null;
  emit: (event: FlintEvent) => void;
  fetch?: typeof fetch;
  tuning?: SyncTuning;
};

/** The Google OAuth client from settings, falling back to the FLINT_GOOGLE_* environment variables. */
export function googleClientFrom(settings: Settings, env: NodeJS.ProcessEnv = process.env): GoogleClient | null {
  const clientId = settings.google.clientId || env["FLINT_GOOGLE_CLIENT_ID"] || "";
  const clientSecret = settings.google.clientSecret || env["FLINT_GOOGLE_CLIENT_SECRET"] || "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** One AccountSync per enabled account: start, stop and restart as accounts change, plus a status map. */
export class SyncManager {
  readonly #d: SyncManagerDeps;
  readonly #syncs = new Map<AccountId, AccountSync>();
  readonly #started = new Set<AccountId>();
  readonly #status = new Map<AccountId, SyncStatus>();

  constructor(deps: SyncManagerDeps) {
    this.#d = deps;
  }

  /** Starts the sync loop of every enabled account. */
  startAll(): void {
    for (const account of this.#d.store.listAccounts()) if (account.enabled) this.#startOne(account.id);
  }

  /** (Re)starts one account's sync from scratch, so changed credentials or servers take effect. A disabled account is stopped. */
  async restart(accountId: AccountId): Promise<void> {
    await this.stop(accountId);
    this.#status.delete(accountId);
    const account = this.#d.store.getAccount(accountId);
    if (account?.enabled) this.#startOne(accountId);
  }

  async stop(accountId: AccountId): Promise<void> {
    const sync = this.#syncs.get(accountId);
    this.#syncs.delete(accountId);
    this.#started.delete(accountId);
    if (sync) await sync.stop().catch((error: Error) => log.warn("sync did not stop cleanly", { reason: error.message }));
  }

  /** Forgets an account entirely (after it was deleted). */
  async forget(accountId: AccountId): Promise<void> {
    await this.stop(accountId);
    this.#status.delete(accountId);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#syncs.keys()].map((id) => this.stop(id)));
  }

  /** The account's sync. For a disabled account an idle one is created, so actions on its mail still reach the server. */
  get(accountId: AccountId): AccountSync {
    return this.#syncs.get(accountId) ?? this.#create(accountId);
  }

  running(): AccountSync[] {
    return [...this.#started].map((id) => this.#syncs.get(id)).filter((s): s is AccountSync => s !== undefined);
  }

  isRunning(accountId: AccountId): boolean {
    return this.#started.has(accountId);
  }

  status(accountId: AccountId): SyncStatus {
    return this.#status.get(accountId) ?? this.#syncs.get(accountId)?.status() ?? { accountId, state: "idle" };
  }

  statuses(): SyncStatus[] {
    return this.#d.store.listAccounts().map((a) => this.status(a.id));
  }

  /** Restarts every account that stopped on a sign-in error, e.g. after the Google client was fixed in settings. */
  async restartAuthErrors(): Promise<void> {
    for (const s of this.statuses()) if (s.state === "auth_error") await this.restart(s.accountId);
  }

  #startOne(accountId: AccountId): void {
    if (this.#started.has(accountId)) return;
    this.get(accountId).start();
    this.#started.add(accountId);
  }

  #create(accountId: AccountId): AccountSync {
    const { store, platform, getSettings, googleClient, emit, fetch: fetchImpl, tuning } = this.#d;
    const sync = new AccountSync({
      store,
      accountId,
      dataDir: platform.dataDir,
      getAuth: () => resolveAuth(store.requireAccount(accountId), {
        secrets: platform.secrets,
        google: () => (googleClient ? googleClient() : googleClientFrom(getSettings())) ?? { clientId: "", clientSecret: "" },
        ...(fetchImpl ? { fetch: (url, init) => fetchImpl(url, init) } : {}),
      }),
      emit: (event) => {
        if (event.type === "sync") this.#status.set(event.status.accountId, event.status);
        emit(event);
      },
      ...tuning,
    });
    this.#syncs.set(accountId, sync);
    return sync;
  }
}

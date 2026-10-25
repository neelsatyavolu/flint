import { z } from "zod";
import { logger } from "../log";
import type { SecretStore } from "../platform";
import type { Store } from "../store";
import type { ReceiptChange } from "../store/types";
import { FlintError, type Address, type FlintEvent, type ReceiptStatus, type Settings, type ThreadId } from "../types";
import { countedOpens, recipientIds, statusKey, statusesForTokens, stampReply, trackedIdsForThread } from "./db";
import { callService, ServiceHttpError, type FetchLike } from "./http";
import { newToken, normalizeEndpoint, pixelUrlFor } from "./pixel";
import {
  EventsResponseSchema, InstallResponseSchema, MAX_EVENTS_LIMIT, MAX_RECIPIENTS, OkResponseSchema, RegisterMessageResponseSchema,
  type ReceiptEvent,
} from "./protocol";

const log = logger("receipts");

export const CREDENTIALS_KEY = "receipts:credentials";
const CURSOR_KEY = "receipts:cursor";
const MAX_PAGES_PER_POLL = 20;

export type ReceiptsClientDeps = {
  store: Store;
  secrets: SecretStore;
  getSettings: () => Settings;
  fetch?: FetchLike;
  now?: () => number;
  /** Receives 'receipt' events. Optional so tests and the CLI can run without a bus. */
  emit?: (event: FlintEvent) => void;
  timeoutMs?: number;
};

export type PrepareTrackedInput = {
  accountId: string;
  subject: string;
  messageId: string;
  recipients: Address[];
  /** Lowercase-insensitive: the user's own addresses and aliases. */
  selfAddresses: readonly string[];
};

export type PreparedTracking = {
  ref: string;
  perRecipient: { address: Address; token: string; pixelUrl: string }[];
  untracked: Address[];
};

export type ReplyTarget = { threadId: ThreadId } | { accountId: string; messageId: string };

const storedCredentials = z.object({ installId: z.string(), secret: z.string(), endpoint: z.string().optional() });
type Credentials = z.infer<typeof storedCredentials>;

const lower = (a: Address): string => a.address.trim().toLowerCase();
const stripBrackets = (id: string): string => id.replace(/^<+|>+$/g, "");

export class ReceiptsClient {
  readonly #store: Store;
  readonly #secrets: SecretStore;
  readonly #getSettings: () => Settings;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #emit: (event: FlintEvent) => void;
  readonly #timeoutMs: number;
  #installing: Promise<Credentials> | null = null;

  constructor(deps: ReceiptsClientDeps) {
    this.#store = deps.store;
    this.#secrets = deps.secrets;
    this.#getSettings = deps.getSettings;
    this.#fetch = deps.fetch ?? ((input, init) => fetch(input, init));
    this.#now = deps.now ?? Date.now;
    this.#emit = deps.emit ?? (() => undefined);
    this.#timeoutMs = deps.timeoutMs ?? 8000;
  }

  /** True when receipts are switched on and an endpoint is configured. */
  isConfigured(): boolean {
    const s = this.#getSettings().receipts;
    return s.enabled && normalizeEndpoint(s.endpoint) !== null;
  }

  /** Registers this install with the service once and keeps the credentials in secrets. */
  ensureInstall(): Promise<{ installId: string; secret: string }> {
    const endpoint = this.#endpoint();
    if (!endpoint) return Promise.reject(new FlintError("invalid", "Read receipts need a service address. Add one in Settings."));
    this.#installing ??= this.#install(endpoint).finally(() => { this.#installing = null; });
    return this.#installing;
  }

  async #install(endpoint: string): Promise<Credentials> {
    const raw = await this.#secrets.get(CREDENTIALS_KEY);
    if (raw) {
      try {
        const parsed = storedCredentials.safeParse(JSON.parse(raw));
        if (parsed.success && (parsed.data.endpoint ?? endpoint) === endpoint) return parsed.data;
      } catch { /* fall through and install again */ }
    }
    const res = await callService({ fetch: this.#fetch, baseUrl: endpoint, timeoutMs: this.#timeoutMs }, "POST", "/v1/install", InstallResponseSchema, {});
    const creds: Credentials = { installId: res.installId, secret: res.secret, endpoint };
    await this.#secrets.set(CREDENTIALS_KEY, JSON.stringify(creds));
    return creds;
  }

  /**
   * Generates a token per recipient and registers them. Never throws for service problems:
   * on any failure every recipient comes back untracked and the tracked row is marked 'unregistered'.
   */
  async prepareTracked(input: PrepareTrackedInput): Promise<PreparedTracking> {
    const ref = newToken();
    const own = new Set(input.selfAddresses.map((a) => a.trim().toLowerCase()));
    const seen = new Set<string>();
    const candidates: Address[] = [];
    const untracked: Address[] = [];
    for (const r of input.recipients) {
      const key = lower(r);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      (own.has(key) || candidates.length >= MAX_RECIPIENTS ? untracked : candidates).push(r);
    }
    if (!this.#getSettings().receipts.enabled || candidates.length === 0) return { ref, perRecipient: [], untracked: [...candidates, ...untracked] };

    const tokens = candidates.map(() => newToken());
    const sentAt = this.#now();
    let state: "active" | "unregistered" = "unregistered";
    try {
      if (this.#endpoint()) {
        await this.#call("POST", "/v1/messages", RegisterMessageResponseSchema, { ref, recipients: tokens.map((token) => ({ token })) });
        state = "active";
      }
    } catch (err) {
      log.warn("receipt registration failed", { error: err instanceof Error ? err.message : String(err) });
    }
    this.#store.createTracked({
      accountId: input.accountId, ref, messageId: stripBrackets(input.messageId), threadId: null, subject: input.subject, sentAt, state,
      recipients: candidates.map((a, i) => ({ email: a.address, name: a.name, token: tokens[i]! })),
    });
    if (state === "unregistered") return { ref, perRecipient: [], untracked: [...candidates, ...untracked] };
    const endpoint = this.#endpoint()!;
    return {
      ref,
      perRecipient: candidates.map((address, i) => ({ address, token: tokens[i]!, pixelUrl: pixelUrlFor(endpoint, tokens[i]!) })),
      untracked,
    };
  }

  /**
   * Fetches new events, stores them (idempotent on the service event id), recomputes recipient status
   * and emits 'receipt' events for status changes when notifyOnOpen is on. Returns how many new counted opens arrived.
   */
  async pollEvents(): Promise<number> {
    if (!this.isConfigured()) return 0;
    const creds = await this.ensureInstall();
    const before = countedOpens(this.#store);
    let cursor = this.#loadCursor(creds.installId);
    for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
      const res = await this.#call("GET", `/v1/events?after=${encodeURIComponent(cursor)}&limit=${MAX_EVENTS_LIMIT}`, EventsResponseSchema);
      if (res.events.length > 0) this.#ingest(res.events);
      const advanced = res.cursor !== cursor;
      cursor = res.cursor;
      this.#saveCursor(creds.installId, cursor);
      if (res.events.length < MAX_EVENTS_LIMIT || !advanced) break;
    }
    return countedOpens(this.#store) - before;
  }

  #ingest(events: ReceiptEvent[]): void {
    const previous = statusesForTokens(this.#store, events.map((e) => e.token));
    const changes = this.#store.ingestReceiptEvents(
      events.map((e) => ({
        remoteId: String(e.id), token: e.token, at: e.at, kind: e.kind, client: e.client, device: e.device,
        location: [e.city, e.country].filter((p): p is string => !!p).join(", ") || null, fingerprint: e.fingerprint,
      })),
      this.#now(),
    );
    if (this.#getSettings().receipts.notifyOnOpen) this.#emitStatusChanges(changes, previous);
  }

  #emitStatusChanges(changes: ReceiptChange[], previous: Map<string, string>): void {
    for (const c of changes) {
      if (previous.get(statusKey(c.trackedId, c.email)) === c.status) continue;
      this.#emit({ type: "receipt", trackedId: c.trackedId, email: c.email, status: c.status as ReceiptStatus, at: c.at });
    }
  }

  /**
   * Called by the service when a reply arrives. Marks the matching recipient as replied even when the
   * reply row has not been linked yet. Emits a 'receipt' event for each status change.
   */
  markReplied(target: ReplyTarget, fromAddress: string, at: number = this.#now()): ReceiptChange[] {
    const email = fromAddress.trim().toLowerCase();
    const trackedIds = "threadId" in target
      ? trackedIdsForThread(this.#store, target.threadId)
      : [this.#store.findTrackedByMessageId(target.accountId, stripBrackets(target.messageId))].filter((id): id is number => id !== null);
    const out: ReceiptChange[] = [];
    for (const trackedId of trackedIds) {
      const recipientId = stampReply(this.#store, trackedId, email, at);
      if (recipientId === null) continue;
      const change = this.#store.recomputeRecipient(recipientId, this.#now());
      if (change) out.push(change);
    }
    for (const c of out) this.#emit({ type: "receipt", trackedId: c.trackedId, email: c.email, status: c.status as ReceiptStatus, at: c.at });
    return out;
  }

  /** Tells the service this machine's address so hits from it are recognized as the sender. Returns false when it failed. */
  async seenPing(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      await this.#call("POST", "/v1/seen", OkResponseSchema, {});
      return true;
    } catch (err) {
      log.warn("seen ping failed", { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  /** Stops tracking: asks the service to forget the message, then marks it stopped locally. */
  async stopTracking(trackedId: number): Promise<void> {
    const tracked = this.#store.getTracked(trackedId);
    if (!tracked) throw new FlintError("not_found", "That tracked message no longer exists.");
    const ref = this.#refOf(trackedId);
    if (ref && this.#isActive(trackedId)) {
      try {
        await this.#call("DELETE", `/v1/messages/${encodeURIComponent(ref)}`, OkResponseSchema);
      } catch (err) {
        if (!(err instanceof ServiceHttpError && err.status === 404)) throw err instanceof FlintError ? err : new FlintError("network", "Couldn't reach the receipts service. Try again.");
      }
    }
    this.#store.setTrackedState(trackedId, "stopped");
    for (const id of recipientIds(this.#store, trackedId)) this.#store.recomputeRecipient(id, this.#now());
  }

  #refOf(trackedId: number): string | null {
    return (this.#store.db.prepare("SELECT ref FROM tracked_messages WHERE id = ?").get(trackedId) as { ref: string } | undefined)?.ref ?? null;
  }

  #isActive(trackedId: number): boolean {
    return (this.#store.db.prepare("SELECT state FROM tracked_messages WHERE id = ?").get(trackedId) as { state: string } | undefined)?.state === "active";
  }

  #endpoint(): string | null {
    return normalizeEndpoint(this.#getSettings().receipts.endpoint);
  }

  /** Authenticated call. A 401 means the service forgot this install, so install again once and retry. */
  async #call<T>(method: "GET" | "POST" | "DELETE", path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const endpoint = this.#endpoint();
    if (!endpoint) throw new FlintError("invalid", "Read receipts need a service address. Add one in Settings.");
    for (let attempt = 0; ; attempt++) {
      const creds = await this.ensureInstall();
      try {
        return await callService({ fetch: this.#fetch, baseUrl: endpoint, timeoutMs: this.#timeoutMs, bearer: `${creds.installId}.${creds.secret}` }, method, path, schema, body);
      } catch (err) {
        if (!(err instanceof ServiceHttpError) || err.status !== 401 || attempt > 0) throw err;
        await this.#secrets.delete(CREDENTIALS_KEY);
      }
    }
  }

  #loadCursor(installId: string): string {
    const raw = this.#store.kvGet(CURSOR_KEY);
    if (!raw) return "0";
    try {
      const parsed = z.object({ installId: z.string(), cursor: z.string() }).safeParse(JSON.parse(raw));
      return parsed.success && parsed.data.installId === installId ? parsed.data.cursor : "0";
    } catch {
      return "0";
    }
  }

  #saveCursor(installId: string, cursor: string): void {
    this.#store.kvSet(CURSOR_KEY, JSON.stringify({ installId, cursor }));
  }
}

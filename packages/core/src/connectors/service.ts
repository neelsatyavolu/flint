import { randomBytes, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { FlintApi } from "../api";
import type { Platform } from "../platform";
import { bodyTextFor, type Store, type StoredMessage } from "../store";
import { CONNECTOR_DAY, type ConnectorDelivery } from "../store/connectors";
import { FlintError, type ConnectorManifest, type ConnectorPreview } from "../types";
import { fetchManifest, manifestHash, manifestUrlFor, needsApproval } from "./manifest";
import { matchesConnector } from "./matcher";
import { assertPublicConnectorUrl } from "./network";
import { deliveryHeaders } from "./signer";

export type ConnectorsApi = Pick<FlintApi, "listConnectors" | "previewConnector" | "openConnectorPairPage" | "pairConnector" | "previewConnectorApproval" | "approveConnector" | "removeConnector">;
/** Older mail without a downloaded body is matched on its headers only. */
const CONNECTOR_BODY_FETCH_DAYS = 14;
type Consent = ConnectorPreview & { expires: number; connectionId: string | null; opened: boolean };
export type ConnectorDeps = {
  store: Store; platform: Pick<Platform, "secrets" | "openExternal">; fetch: typeof fetch; now(): number;
  ensureBodies(ids: number[]): Promise<void>; poke(): void;
  checkUrl?(url: string): Promise<void>;
};
const keyFor = (id: string) => `connector:${id}`;
const matches = (manifest: ConnectorManifest, m: StoredMessage) => matchesConnector(manifest, { ...m, body: bodyTextFor(m.text, m.rawHtml) }, m.rawHtml);

/** Main-process connector lifecycle. Serialized changes prevent removal/consent changes racing a push. */
export class ConnectorService {
  readonly api: ConnectorsApi;
  #consents = new Map<string, Consent>();
  #tail: Promise<unknown> = Promise.resolve();
  #stopped = false;
  #nextDeliveryAt = 0;
  #unlisten: () => void;

  constructor(private deps: ConnectorDeps) {
    this.#unlisten = deps.store.onIngest(() => deps.poke());
    this.api = {
      listConnectors: async () => deps.store.listConnectors(),
      previewConnector: (url) => this.#serial(async () => {
        const manifestUrl = manifestUrlFor(url);
        return this.#preview(manifestUrl, await fetchManifest(manifestUrl, deps.fetch, deps.checkUrl), null);
      }),
      openConnectorPairPage: (token) => this.#serial(async () => {
        const consent = this.#consent(token, null);
        await deps.platform.openExternal(consent.manifest.pairPage);
        consent.opened = true;
      }),
      pairConnector: (token, code) => this.#serial(() => this.#pair(token, code)),
      previewConnectorApproval: (id) => this.#serial(async () => {
        const connection = deps.store.requireConnector(id);
        if (connection.status !== "needs_approval" || !connection.pendingManifest) throw new FlintError("invalid", "This app has no changes to approve.");
        return this.#preview(connection.manifestUrl, connection.pendingManifest, id);
      }),
      approveConnector: (id, token) => this.#serial(async () => {
        const consent = this.#consent(token, id);
        const connection = deps.store.requireConnector(id);
        if (connection.status !== "needs_approval" || !connection.pendingManifest || manifestHash(connection.pendingManifest) !== manifestHash(consent.manifest)) {
          throw new FlintError("conflict", "The app's request changed. Review it again.");
        }
        deps.store.transaction(() => {
          deps.store.setConnectorManifest(id, consent.manifest, false, deps.now());
          deps.store.backfillConnector(id, deps.now() - consent.manifest.historyDays * CONNECTOR_DAY, deps.now());
        });
        this.#consents.delete(token);
        deps.poke();
      }),
      removeConnector: (id) => this.#serial(() => this.#remove(id)),
    };
  }

  nextDueAt(): number | null {
    const due = this.#stopped ? null : this.deps.store.nextConnectorJob();
    return due === null ? null : Math.max(due, this.#nextDeliveryAt);
  }

  run(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    return this.#serial(async () => {
      const { store, now } = this.deps;
      // Re-check before delivering anything due today. The approved snapshot remains frozen on fetch failure.
      for (const connection of store.connectorsToCheck(now()).slice(0, 1)) {
        if (this.#stopped) return;
        try {
          const next = await fetchManifest(connection.manifestUrl, this.deps.fetch, this.deps.checkUrl);
          store.setConnectorManifest(connection.id, next, needsApproval(connection.manifest, next), now());
        } catch {
          store.connectorChecked(connection.id, now());
        }
      }
      // Yield between requests so removal and fresh consent never wait behind a backfill batch.
      // All overdue manifest checks precede deliveries, even across these short scheduler turns.
      if (store.connectorsToCheck(now()).length || now() < this.#nextDeliveryAt) return;
      for (const delivery of store.dueConnectorDeliveries(now()).slice(0, 1)) {
        if (this.#stopped) return;
        await this.#deliver(delivery);
      }
    });
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#unlisten();
    this.#consents.clear();
    await this.#tail;
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#stopped) return Promise.reject(new FlintError("invalid", "Connected apps are shutting down."));
    const result = this.#tail.then(fn);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  #consent(token: string, id: string | null): Consent {
    const consent = this.#consents.get(token);
    if (!consent || consent.expires < this.deps.now() || consent.connectionId !== id) {
      throw new FlintError("invalid", "This preview expired. Review the app again.");
    }
    return consent;
  }

  async #preview(manifestUrl: string, manifest: ConnectorManifest, connectionId: string | null): Promise<ConnectorPreview> {
    const { store, now, ensureBodies } = this.deps;
    const ids = store.connectorHistory(now() - manifest.historyDays * CONNECTOR_DAY);
    let count = 0;
    const subjects: string[] = [];
    const take = (subject: string) => {
      count++;
      if (subjects.length < 5) subjects.push(subject);
    };
    // Header rules see the whole window. Body rules only see bodies on this computer, plus recent
    // mail fetched in one batch: never download a year of mail just to search it.
    const toFetch: number[] = [];
    for (const id of ids) {
      if (this.#stopped) throw new FlintError("invalid", "Connected apps are shutting down.");
      const m = store.getMessage(id);
      if (!m || !store.connectorEligible(id)) continue;
      if (matches(manifest, m)) take(m.subject);
      else if (this.#mayFetchBody(manifest, m)) toFetch.push(id);
    }
    if (toFetch.length) {
      // A body that can't be fetched just isn't counted; the header matches above still are.
      await ensureBodies(toFetch).catch(() => undefined);
      for (const id of toFetch) {
        const m = store.getMessage(id);
        if (m?.bodyLoaded && store.connectorEligible(id) && matches(manifest, m)) take(m.subject);
      }
    }
    for (const [token, c] of this.#consents) if (c.expires < now()) this.#consents.delete(token);
    // Keep only a small number of pending consent sheets, all scoped to this running desktop process.
    if (this.#consents.size >= 20) this.#consents.delete(this.#consents.keys().next().value!);
    const preview: ConnectorPreview = { token: randomUUID(), manifestUrl, manifest, count, subjects };
    this.#consents.set(preview.token, { ...preview, connectionId, expires: now() + 30 * 60_000, opened: false });
    return preview;
  }

  async #pair(token: string, code: string) {
    const consent = this.#consent(token, null);
    if (!consent.opened) throw new FlintError("invalid", "Open the app to get a pairing code first.");
    // Apps may show the code grouped ("ABCD-EFGH"); send just the characters.
    code = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 8) throw new FlintError("invalid", "Enter the app's 8-character code.");
    const { store, now, platform } = this.deps;
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const response = await this.#post(consent.manifest.pairEndpoint, JSON.stringify({
      code, connectionId: id, secret, deviceName: hostname(), manifestHash: manifestHash(consent.manifest),
    }));
    await response.body?.cancel();
    if (!response.ok) throw new FlintError("invalid", `Pairing failed (HTTP ${response.status}). Get a new code from the app and try again.`);
    try {
      await platform.secrets.set(keyFor(id), secret);
      store.transaction(() => {
        store.insertConnector(id, consent.manifestUrl, consent.manifest, now());
        store.backfillConnector(id, now() - consent.manifest.historyDays * CONNECTOR_DAY, now());
      });
    } catch (error) {
      await this.#revoke(id, consent.manifest, secret).catch(() => undefined);
      await platform.secrets.delete(keyFor(id));
      throw error;
    }
    this.#consents.delete(token);
    this.deps.poke();
    return store.requireConnector(id);
  }

  async #post(url: string, body: string, headers: Record<string, string> = { "Content-Type": "application/json" }, messageRowId?: number): Promise<Response> {
    await (this.deps.checkUrl ?? assertPublicConnectorUrl)(url);
    // Recheck after asynchronous secret/DNS work, immediately before handing mail to fetch.
    if (messageRowId !== undefined && !this.deps.store.connectorEligible(messageRowId)) {
      throw new FlintError("invalid", "This message is no longer eligible for sharing.");
    }
    return this.deps.fetch(url, { method: "POST", body, headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
  }

  async #revoke(id: string, manifest: ConnectorManifest, secret: string): Promise<void> {
    const body = JSON.stringify({ connectionId: id });
    const response = await this.#post(manifest.revokeEndpoint, body, deliveryHeaders(id, secret, Math.floor(this.deps.now() / 1000), body));
    await response.body?.cancel();
  }

  async #remove(id: string): Promise<void> {
    const { store, platform } = this.deps;
    const connection = store.requireConnector(id);
    store.stopConnector(id);
    const secret = await platform.secrets.get(keyFor(id));
    // Removal always stops local access, even if the remote app is offline or already revoked this connection.
    if (secret) await this.#revoke(id, connection.manifest, secret).catch(() => undefined);
    await platform.secrets.delete(keyFor(id));
    store.deleteConnector(id);
    for (const [token, consent] of this.#consents) if (consent.connectionId === id) this.#consents.delete(token);
    this.deps.poke();
  }

  /** A body rule could still match, and the body is on this computer or recent enough to fetch. */
  #mayFetchBody(manifest: ConnectorManifest, m: { bodyLoaded: boolean; date: number }): boolean {
    const bodyRules = manifest.match.schemaTypes.length > 0 || manifest.match.any.some((c) => c.field === "body");
    return bodyRules && (m.bodyLoaded || m.date >= this.deps.now() - CONNECTOR_BODY_FETCH_DAYS * CONNECTOR_DAY);
  }

  async #deliver(delivery: ConnectorDelivery): Promise<void> {
    const { store, now, platform, ensureBodies } = this.deps;
    const finish = (state: "failed" | "skipped") => store.finishConnectorDelivery(delivery, state, now());
    store.beginConnectorDelivery(delivery, now());
    if (now() >= delivery.first_attempt! + CONNECTOR_DAY) { finish("failed"); return; }
    const id = delivery.message_row_id;
    if (id === null || !store.connectorEligible(id)) { finish("skipped"); return; }
    const connection = store.requireConnector(delivery.connection_id);
    if (connection.status !== "active") return;
    try {
      let m = store.getMessage(id);
      if (!m) { finish("skipped"); return; }
      // Fetch a body only for mail its headers already match, or recent mail Flint downloads anyway.
      if (!matches(connection.manifest, m) && !this.#mayFetchBody(connection.manifest, m)) { finish("skipped"); return; }
      if (!m.bodyLoaded) await ensureBodies([id]);
      m = store.getMessage(id);
      if (!m || !store.connectorEligible(id)) { finish("skipped"); return; }
      if (!m.bodyLoaded) { store.retryConnectorDelivery(delivery, now()); return; }
      if (!matches(connection.manifest, m)) { finish("skipped"); return; }
      if (this.#stopped) return;
      const secret = await platform.secrets.get(keyFor(connection.id));
      if (!secret) { store.stopConnector(connection.id); return; }
      const values = { messageId: m.messageId, from: m.from, to: m.to, subject: m.subject, date: m.date, text: m.text, html: m.rawHtml };
      const body = JSON.stringify(Object.fromEntries(connection.manifest.fields.map((field) => [field, values[field]])));
      const response = await this.#post(connection.manifest.deliverEndpoint, body, {
        ...deliveryHeaders(connection.id, secret, Math.floor(now() / 1000), body),
        "Idempotency-Key": `${connection.id}:${m.messageId || m.id}`,
      }, id);
      try { await response.body?.cancel(); } catch { /* Cleanup cannot change the server's delivery result. */ }
      if (response.status === 401 || response.status === 410) { store.stopConnector(connection.id); return; }
      if (response.status >= 500 || [408, 425, 429].includes(response.status)) {
        const retryAfter = response.headers.get("Retry-After")?.trim();
        store.retryConnectorDelivery(delivery, now(), retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1_000 : 0);
        return;
      }
      if (!response.ok) { finish("failed"); return; }
      this.#nextDeliveryAt = now() + 1_000;
      store.transaction(() => {
        store.finishConnectorDelivery(delivery, "delivered", now());
        // Metadata only: no subjects, addresses, RFC message ids, bodies, or server response content.
        store.insertActivity({ agent: "Connected apps", method: "connector.push", summary: "Pushed 1 message", status: "ok", at: now(), detail: { connectionId: connection.id, count: 1 } });
      });
    } catch {
      // Eligibility may change during secret/DNS work; never retry mail that is now excluded.
      if (!store.connectorEligible(id)) { finish("skipped"); return; }
      // Network errors and temporarily unavailable bodies use the same durable retry deadline.
      store.retryConnectorDelivery(delivery, now());
    }
  }
}

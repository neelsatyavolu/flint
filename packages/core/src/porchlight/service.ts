import { hostname } from "node:os";
import type { FlintApi } from "../api";
import type { Platform } from "../platform";
import type { Store, StoredMessage } from "../store";
import { PORCHLIGHT_DAY, PORCHLIGHT_HISTORY_DAYS, type PorchlightImportRow } from "../store/porchlight";
import { detectTracking, mayCarryTracking } from "../tracking/detect";
import { FlintError, type PorchlightStatus } from "../types";
import { porchlightCarrier } from "./carriers";
import { PorchlightClient, PorchlightHttpError, type FlintImportItem } from "./client";

export type PorchlightApi = Pick<FlintApi, "porchlightStatus" | "pairPorchlight" | "disconnectPorchlight" | "listPorchlightPackages">;
export type PorchlightDeps = {
  store: Store; platform: Pick<Platform, "secrets">; fetch: typeof fetch; now(): number;
  ensureBodies(ids: number[]): Promise<void>; poke(): void;
  /** The device part of the token label, "Flint on <name>". Defaults to this computer's host name. */
  deviceName?: () => string;
  origin?: string;
};

export const PORCHLIGHT_SECRET = "porchlight:token";
/** Messages looked at per scheduler turn (Porchlight takes up to 100 items a request). */
const BATCH = 25;
type Secret = { token: string; tokenId: string };

/** Pairing, the import queue and its delivery. Serialized, so disconnecting never races a request in flight. */
export class PorchlightService {
  readonly api: PorchlightApi;
  #client: PorchlightClient;
  #tail: Promise<unknown> = Promise.resolve();
  #stopped = false;
  #unlisten: () => void;

  constructor(private deps: PorchlightDeps) {
    this.#client = new PorchlightClient(deps.fetch, deps.origin);
    this.#unlisten = deps.store.onIngest(() => deps.poke());
    this.api = {
      porchlightStatus: async () => this.#status(),
      pairPorchlight: (code) => this.#serial(() => this.#pair(code)),
      disconnectPorchlight: () => this.#serial(() => this.#disconnect()),
      listPorchlightPackages: async (opts = {}) => {
        if (opts.threadId !== undefined && (!Number.isInteger(opts.threadId) || opts.threadId <= 0)) throw new FlintError("invalid", "threadId must be a positive whole number.");
        if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit <= 0)) throw new FlintError("invalid", "limit must be a positive whole number.");
        return deps.store.listPorchlightPackages(opts);
      },
    };
  }

  nextDueAt(): number | null {
    return this.#stopped ? null : this.deps.store.nextPorchlightJob();
  }

  run(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    return this.#serial(() => this.#run());
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#unlisten();
    await this.#tail;
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#stopped) return Promise.reject(new FlintError("invalid", "Porchlight is shutting down."));
    const result = this.#tail.then(fn);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  #status(): PorchlightStatus {
    const c = this.deps.store.porchlightConnection();
    return {
      connection: c ? { label: c.label, pairedAt: c.paired_at, signedOut: c.status === "signed_out" } : null,
      ...this.deps.store.porchlightCounts(),
      lastImportAt: c?.last_import_at ?? null,
    };
  }

  async #pair(raw: string): Promise<PorchlightStatus> {
    const code = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 8) throw new FlintError("invalid", "Enter the 8-character code from Porchlight Settings.");
    const { store, platform, now } = this.deps;
    const label = `Flint on ${(this.deps.deviceName ?? defaultDeviceName)()}`.slice(0, 100);
    let claimed: { token: string; tokenId: string };
    try {
      claimed = await this.#client.claim(code, label);
    } catch (error) {
      throw pairingError(error);
    }
    const previous = await readSecret(platform);
    try {
      await platform.secrets.set(PORCHLIGHT_SECRET, JSON.stringify({ token: claimed.token, tokenId: claimed.tokenId } satisfies Secret));
      store.transaction(() => {
        store.savePorchlightConnection(claimed.tokenId, label, now());
        store.queuePorchlightMessages(store.connectorHistory(now() - PORCHLIGHT_HISTORY_DAYS * PORCHLIGHT_DAY), now());
      });
    } catch (error) {
      await this.#client.revoke(claimed.token, claimed.tokenId);
      if (previous) await platform.secrets.set(PORCHLIGHT_SECRET, JSON.stringify(previous)).catch(() => undefined);
      else await platform.secrets.delete(PORCHLIGHT_SECRET).catch(() => undefined);
      throw error;
    }
    // A token replaced by pairing again is no longer needed.
    if (previous && previous.tokenId !== claimed.tokenId) await this.#client.revoke(previous.token, previous.tokenId);
    this.deps.poke();
    return this.#status();
  }

  async #disconnect(): Promise<{ revoked: boolean }> {
    const { store, platform } = this.deps;
    const secret = await readSecret(platform);
    // Local access stops first, whatever Porchlight says.
    store.deletePorchlight();
    await platform.secrets.delete(PORCHLIGHT_SECRET);
    this.deps.poke();
    return { revoked: secret ? await this.#client.revoke(secret.token, secret.tokenId) : false };
  }

  async #run(): Promise<void> {
    const { store, now } = this.deps;
    const connection = store.porchlightConnection();
    if (!connection || connection.status !== "active") return;
    const rows = store.duePorchlightImports(now(), BATCH);
    if (!rows.length) return;
    try {
      await this.#send(rows);
    } catch {
      // Anything unexpected (a locked keychain, a bad row) backs the batch off; left due, it would rerun at once, forever.
      for (const row of rows) store.retryPorchlightImport(row, now());
    }
  }

  async #send(rows: PorchlightImportRow[]): Promise<void> {
    const { store, now, platform } = this.deps;
    const secret = await readSecret(platform);
    if (!secret) { store.setPorchlightSignedOut(); return; }

    const ready = await this.#detect(rows);
    if (this.#stopped || !ready.length) return;
    // Recheck after body downloads: a disconnect or a move to spam may have happened meanwhile.
    const items: FlintImportItem[] = [];
    const sent: PorchlightImportRow[] = [];
    for (const { row, item } of ready) {
      if (row.message_row_id === null || !store.connectorEligible(row.message_row_id)) { store.finishPorchlightImport(row.message_id, "skipped"); continue; }
      items.push(item);
      sent.push(row);
    }
    if (!items.length) return;
    try {
      const results = await this.#client.importFlint(secret.token, items);
      const byKey = new Map(results.map((r) => [r.dedupeKey, r]));
      let imported = 0;
      store.transaction(() => {
        for (const [i, row] of sent.entries()) {
          const result = byKey.get(row.message_id) ?? results[i];
          if (!result) store.retryPorchlightImport(row, now());
          else if (result.outcome === "rejected" || !result.packageId) store.finishPorchlightImport(row.message_id, "rejected");
          else { store.markPorchlightImported(row.message_id, result.packageId, now()); imported++; }
        }
        // Metadata only: no subjects, numbers, senders or Message-IDs.
        if (imported) store.insertActivity({ agent: "Porchlight", method: "porchlight.import", summary: `Sent ${imported} ${imported === 1 ? "package" : "packages"} to Porchlight`, status: "ok", at: now(), detail: { count: imported } });
      });
    } catch (error) {
      const status = error instanceof PorchlightHttpError ? error.status : 0;
      if (status === 401 || status === 403) { store.setPorchlightSignedOut(); return; }
      if (status === 400 || status === 413) { for (const row of sent) store.finishPorchlightImport(row.message_id, "failed"); return; }
      const retryAfter = error instanceof PorchlightHttpError ? error.retryAfterMs : 0;
      for (const row of sent) store.retryPorchlightImport(row, now(), retryAfter);
      return;
    }
    if (store.duePorchlightImports(now(), 1).length) this.deps.poke();
  }

  /** Finds the package in each due message, downloading bodies only for mail whose headers look like shipping mail. */
  async #detect(rows: PorchlightImportRow[]): Promise<{ row: PorchlightImportRow; item: FlintImportItem }[]> {
    const { store, now, ensureBodies } = this.deps;
    const toFetch: number[] = [];
    for (const row of rows) {
      const m = row.tracking_number === null && row.message_row_id !== null ? store.getMessage(row.message_row_id) : null;
      if (m && !m.bodyLoaded && mayCarryTracking(m.subject, m.from[0]?.address ?? "")) toFetch.push(m.id);
    }
    // A body that can't be fetched now (offline) is retried below with the row's backoff.
    if (toFetch.length) await ensureBodies(toFetch).catch(() => undefined);
    const ready: { row: PorchlightImportRow; item: FlintImportItem }[] = [];
    for (const row of rows) {
      const m = row.message_row_id === null ? undefined : store.getMessage(row.message_row_id);
      if (!m || !store.connectorEligible(m.id)) { store.finishPorchlightImport(row.message_id, "skipped"); continue; }
      let carrier = row.carrier;
      let number = row.tracking_number;
      if (number === null) {
        if (!m.bodyLoaded) {
          if (toFetch.includes(m.id)) store.retryPorchlightImport(row, now());
          else store.finishPorchlightImport(row.message_id, "skipped");
          continue;
        }
        const found = findPackage(m);
        if (!found) { store.finishPorchlightImport(row.message_id, "skipped"); continue; }
        ({ carrier, number } = found);
        store.setPorchlightDetected(row.message_id, carrier, number);
      }
      ready.push({ row, item: importItem(row.message_id, m, carrier, number) });
    }
    return ready;
  }
}

function findPackage(m: StoredMessage): { carrier: string | null; number: string } | null {
  const from = m.from[0];
  for (const hit of detectTracking({ subject: m.subject, text: m.text, html: m.rawHtml, fromName: from?.name ?? null, fromAddress: from?.address ?? "" })) {
    if (hit.kind === "package" && hit.tracking) return { carrier: hit.carrier?.value ?? null, number: hit.tracking.value };
  }
  return null;
}

const clip = (value: string | null | undefined, max: number): string | null => {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  return text ? text.slice(0, max) : null;
};

function importItem(dedupeKey: string, m: StoredMessage, carrier: string | null, number: string): FlintImportItem {
  const id = porchlightCarrier(carrier);
  return {
    trackingNumber: number,
    ...(id ? { carrier: id } : {}),
    merchant: clip(m.from[0]?.name, 200),
    subject: clip(m.subject, 500),
    messageDate: new Date(m.date).toISOString(),
    dedupeKey,
  };
}

async function readSecret(platform: Pick<Platform, "secrets">): Promise<Secret | null> {
  const raw = await platform.secrets.get(PORCHLIGHT_SECRET);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Secret>;
    return typeof value.token === "string" && typeof value.tokenId === "string" ? { token: value.token, tokenId: value.tokenId } : null;
  } catch {
    return null;
  }
}

function defaultDeviceName(): string {
  return hostname().replace(/\.local$/i, "").replace(/-/g, " ").trim() || "this Mac";
}

function pairingError(error: unknown): FlintError {
  const status = error instanceof PorchlightHttpError ? error.status : 0;
  if (status === 401 || status === 400) return new FlintError("invalid", "That code didn't work. Codes work once and expire after 10 minutes, so get a new one in Porchlight Settings.");
  if (status === 429) return new FlintError("invalid", "Too many tries. Wait a few minutes, then try a new code.");
  if (status === 0) return new FlintError("network", "Couldn't reach Porchlight. Check your connection and try again.");
  return new FlintError("internal", `Porchlight couldn't pair right now (HTTP ${status}). Try again in a minute.`);
}

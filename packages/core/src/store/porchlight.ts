import type { PorchlightPackage, ThreadId } from "../types";
import type { Sql } from "./sql";

export const PORCHLIGHT_DAY = 86_400_000;
/** New mail older than this is not imported, and pairing imports this much history. */
export const PORCHLIGHT_HISTORY_DAYS = 30;
/** A row that still can't be sent after this long (offline for a week, server down) is given up. */
const GIVE_UP_MS = 7 * PORCHLIGHT_DAY;
export const PORCHLIGHT_ORIGIN = "https://porchlight.xanom.co";

export type PorchlightConnectionRow = {
  token_id: string; label: string; paired_at: number; status: "active" | "signed_out"; last_import_at: number | null;
};
export type PorchlightImportRow = {
  message_id: string; message_row_id: number | null; state: "pending" | "imported" | "skipped" | "rejected" | "failed";
  carrier: string | null; tracking_number: string | null; package_id: string | null;
  attempts: number; created_at: number; next_attempt: number; imported_at: number | null;
};

/** The dedupe key Porchlight sees: the Message-ID in angle brackets, or a local stand-in when the mail has none. */
const DEDUPE_KEY = "COALESCE(NULLIF(m.message_id, ''), 'flint-row-' || m.id)";

/** Called inside the ingest transaction: queue recent mail for detection while Porchlight is paired. Cheap; detection runs later. */
export function enqueuePorchlightIngest(q: Sql, messageRowId: number, now: number): void {
  q.run(`INSERT INTO porchlight_imports (message_id, message_row_id, created_at, next_attempt)
    SELECT ${DEDUPE_KEY}, m.id, ?, ? FROM messages m
    WHERE m.id = ? AND m.draft = 0 AND m.date >= ? AND EXISTS (SELECT 1 FROM porchlight_connection WHERE status = 'active')
    ON CONFLICT (message_id) DO NOTHING`, now, now, messageRowId, now - PORCHLIGHT_HISTORY_DAYS * PORCHLIGHT_DAY);
}

export class PorchlightRepo {
  constructor(protected q: Sql) {}

  porchlightConnection(): PorchlightConnectionRow | null {
    return this.q.get<PorchlightConnectionRow>("SELECT * FROM porchlight_connection WHERE id = 1") ?? null;
  }

  /** Replaces any earlier connection. Rows already imported stay; their packages are still in the same account or a new one. */
  savePorchlightConnection(tokenId: string, label: string, now: number): void {
    this.q.run(`INSERT INTO porchlight_connection (id, token_id, label, paired_at, status) VALUES (1, ?, ?, ?, 'active')
      ON CONFLICT (id) DO UPDATE SET token_id = excluded.token_id, label = excluded.label, paired_at = excluded.paired_at, status = 'active'`,
    tokenId, label, now);
  }

  setPorchlightSignedOut(): void {
    this.q.run("UPDATE porchlight_connection SET status = 'signed_out' WHERE id = 1");
  }

  /** Forgets the connection and every queued or imported row. */
  deletePorchlight(): void {
    this.q.run("DELETE FROM porchlight_imports");
    this.q.run("DELETE FROM porchlight_connection");
  }

  /**
   * Queues these messages (already filtered for eligibility) for detection; imported and rejected mail keeps its row.
   * Rows still pending (queued while signed out) or given up start a fresh week, so pairing again never gives up at once.
   */
  queuePorchlightMessages(ids: number[], now: number): void {
    for (const id of ids) {
      this.q.run(`INSERT INTO porchlight_imports (message_id, message_row_id, created_at, next_attempt)
        SELECT ${DEDUPE_KEY}, m.id, ?, ? FROM messages m WHERE m.id = ?
        ON CONFLICT (message_id) DO UPDATE SET state = 'pending', attempts = 0, next_attempt = excluded.next_attempt,
          created_at = excluded.created_at, message_row_id = excluded.message_row_id
        WHERE porchlight_imports.state IN ('pending', 'skipped', 'failed')`, now, now, id);
    }
  }

  nextPorchlightJob(): number | null {
    const r = this.q.get<{ due: number | null }>(`SELECT MIN(i.next_attempt) AS due FROM porchlight_imports i
      WHERE i.state = 'pending' AND EXISTS (SELECT 1 FROM porchlight_connection WHERE status = 'active')`);
    return r?.due ?? null;
  }

  duePorchlightImports(now: number, limit: number): PorchlightImportRow[] {
    return this.q.all<PorchlightImportRow>(`SELECT * FROM porchlight_imports WHERE state = 'pending' AND next_attempt <= ?
      ORDER BY next_attempt, created_at LIMIT ?`, now, limit);
  }

  /** What detection found, kept so a retry doesn't need the body again. */
  setPorchlightDetected(messageId: string, carrier: string | null, trackingNumber: string): void {
    this.q.run("UPDATE porchlight_imports SET carrier = ?, tracking_number = ? WHERE message_id = ?", carrier, trackingNumber, messageId);
  }

  finishPorchlightImport(messageId: string, state: "skipped" | "rejected" | "failed"): void {
    this.q.run("UPDATE porchlight_imports SET state = ? WHERE message_id = ? AND state = 'pending'", state, messageId);
  }

  markPorchlightImported(messageId: string, packageId: string, now: number): void {
    const { changes } = this.q.run("UPDATE porchlight_imports SET state = 'imported', package_id = ?, imported_at = ? WHERE message_id = ? AND state = 'pending'",
      packageId, now, messageId);
    if (changes) this.q.run("UPDATE porchlight_connection SET last_import_at = ? WHERE id = 1", now);
  }

  /** Exponential backoff from 5 s up to an hour; gives up a week after the row was queued. */
  retryPorchlightImport(row: PorchlightImportRow, now: number, retryAfterMs = 0): void {
    const deadline = row.created_at + GIVE_UP_MS;
    if (now >= deadline) { this.finishPorchlightImport(row.message_id, "failed"); return; }
    const delay = Math.min(3_600_000, Math.max(retryAfterMs, 5_000 * 2 ** Math.min(row.attempts, 10)));
    this.q.run("UPDATE porchlight_imports SET attempts = attempts + 1, next_attempt = ? WHERE message_id = ? AND state = 'pending'",
      Math.min(deadline, now + delay), row.message_id);
  }

  porchlightCounts(): { imported: number; pending: number } {
    const r = this.q.get<{ imported: number; pending: number }>(`SELECT
      COALESCE(SUM(state = 'imported'), 0) AS imported, COALESCE(SUM(state = 'pending'), 0) AS pending FROM porchlight_imports`);
    return { imported: r?.imported ?? 0, pending: r?.pending ?? 0 };
  }

  listPorchlightPackages(opts: { threadId?: ThreadId; limit?: number } = {}): PorchlightPackage[] {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 500);
    const rows = this.q.all<{ package_id: string; thread_id: number; carrier: string | null; tracking_number: string; imported_at: number }>(
      `SELECT i.package_id, m.thread_id, i.carrier, i.tracking_number, i.imported_at FROM porchlight_imports i
        JOIN messages m ON m.id = i.message_row_id
        WHERE i.state = 'imported' AND i.package_id IS NOT NULL AND i.tracking_number IS NOT NULL ${opts.threadId === undefined ? "" : "AND m.thread_id = ?"}
        ORDER BY i.imported_at DESC, i.message_id`,
      ...(opts.threadId === undefined ? [] : [opts.threadId]),
    );
    const seen = new Set<string>();
    const out: PorchlightPackage[] = [];
    for (const r of rows) {
      if (seen.has(r.package_id)) continue;
      seen.add(r.package_id);
      out.push({
        packageId: r.package_id, url: `${PORCHLIGHT_ORIGIN}/app/p/${r.package_id}`, threadId: r.thread_id,
        carrier: r.carrier, trackingNumber: r.tracking_number, importedAt: r.imported_at,
      });
      if (out.length >= limit) break;
    }
    return out;
  }
}

import type { ConnectorConnection, ConnectorManifest } from "../types";
import { FlintError } from "../types";
import { evaluateRules, senderMatchesBlocked } from "../rules";
import { bodyTextFor } from "./fts";
import { addresses } from "./mappers";
import { RulesRepo } from "./rulesRepo";
import { parseJson, type Sql } from "./sql";

export const CONNECTOR_DAY = 86_400_000;
export type ConnectorDelivery = {
  connection_id: string; message_id: string; message_row_id: number | null;
  state: "pending" | "delivered" | "failed" | "skipped";
  attempts: number; created_at: number; first_attempt: number | null; next_attempt: number;
};
type ConnectionRow = {
  id: string; manifest_url: string; manifest_json: string; pending_manifest_json: string | null;
  status: ConnectorConnection["status"]; checked_at: number; last_delivery: number | null; delivered_count: number;
};
function connection(r: ConnectionRow): ConnectorConnection {
  return {
    id: r.id, manifestUrl: r.manifest_url, manifest: JSON.parse(r.manifest_json) as ConnectorManifest,
    pendingManifest: r.pending_manifest_json ? JSON.parse(r.pending_manifest_json) as ConnectorManifest : null,
    status: r.status, lastDelivery: r.last_delivery, deliveredCount: r.delivered_count,
  };
}

/** Checks every folder membership, including Gmail labels, rather than only the source mailbox. */
const ELIGIBLE = `m.draft = 0
  AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = m.folder_id AND f.role IN ('spam','trash','sent','drafts'))
  AND NOT EXISTS (SELECT 1 FROM message_folders mf JOIN folders f ON f.id = mf.folder_id
    WHERE mf.message_id = m.id AND f.role IN ('spam','trash','sent','drafts'))`;

const DELIVERY_ID = "COALESCE(NULLIF(m.message_id, ''), CAST(m.id AS TEXT))";

/** Ingest may skip rule evaluation during history sync. Export always applies the current privacy filters. */
function connectorEligible(q: Sql, id: number): boolean {
  const message = q.get<{
    account_id: string; from_json: string; to_json: string; cc_json: string; bcc_json: string;
    subject: string; text_body: string | null; html_body: string | null; headers_json: string; has_attachments: number;
  }>(`SELECT m.* FROM messages m WHERE m.id = ? AND ${ELIGIBLE}`, id);
  if (!message) return false;
  const rules = new RulesRepo(q);
  const from = addresses(message.from_json);
  const blocked = rules.blockedPatterns();
  if (from.some((sender) => senderMatchesBlocked(sender.address, blocked))) return false;
  const actions = evaluateRules(rules.listRulesFor(message.account_id), {
    accountId: message.account_id, from, to: addresses(message.to_json), cc: addresses(message.cc_json), bcc: addresses(message.bcc_json),
    subject: message.subject, body: bodyTextFor(message.text_body, message.html_body),
    headers: parseJson<Record<string, string>>(message.headers_json, {}), hasAttachments: message.has_attachments === 1,
  });
  return !actions.some((action) => action.type === "trash" || (action.type === "move" && Boolean(q.get(
    "SELECT id FROM folders WHERE account_id = ? AND path = ? AND role IN ('spam','trash','sent','drafts')",
    message.account_id, action.folderPath,
  ))));
}

/** Called inside the ingest transaction. Matching/body fetching happen later, after commit. */
export function enqueueConnectorIngest(q: Sql, messageRowId: number, now: number): void {
  if (!connectorEligible(q, messageRowId)) return;
  q.run(`INSERT INTO connector_deliveries (connection_id, message_id, message_row_id, created_at, next_attempt)
    SELECT c.id, ${DELIVERY_ID}, m.id, ?, ? FROM connector_connections c CROSS JOIN messages m
    WHERE m.id = ? AND c.status IN ('active','needs_approval')
    ON CONFLICT (connection_id, message_id) DO UPDATE SET message_row_id = excluded.message_row_id
      WHERE connector_deliveries.state = 'pending'`, now, now, messageRowId);
}

export class ConnectorsRepo {
  constructor(protected q: Sql) {}

  listConnectors(): ConnectorConnection[] {
    return this.q.all<ConnectionRow>("SELECT * FROM connector_connections ORDER BY rowid").map(connection);
  }

  requireConnector(id: string): ConnectorConnection {
    const r = this.q.get<ConnectionRow>("SELECT * FROM connector_connections WHERE id = ?", id);
    if (!r) throw new FlintError("not_found", "That connected app no longer exists.");
    return connection(r);
  }

  insertConnector(id: string, url: string, manifest: ConnectorManifest, now: number): ConnectorConnection {
    this.q.run("INSERT INTO connector_connections (id, manifest_url, manifest_json, checked_at) VALUES (?,?,?,?)", id, url, JSON.stringify(manifest), now);
    return this.requireConnector(id);
  }

  setConnectorManifest(id: string, manifest: ConnectorManifest, approval: boolean, now: number): void {
    if (approval) this.q.run("UPDATE connector_connections SET status = 'needs_approval', pending_manifest_json = ?, checked_at = ? WHERE id = ?", JSON.stringify(manifest), now, id);
    else this.q.run("UPDATE connector_connections SET status = 'active', manifest_json = ?, pending_manifest_json = NULL, checked_at = ? WHERE id = ?", JSON.stringify(manifest), now, id);
  }

  connectorChecked(id: string, now: number): void {
    this.q.run("UPDATE connector_connections SET checked_at = ? WHERE id = ?", now, id);
  }

  stopConnector(id: string): void {
    this.q.run("UPDATE connector_connections SET status = 'stopped' WHERE id = ?", id);
  }

  deleteConnector(id: string): void {
    this.q.run("DELETE FROM connector_connections WHERE id = ?", id);
  }

  connectorEligible(id: number): boolean {
    return connectorEligible(this.q, id);
  }

  connectorHistory(since: number): number[] {
    return this.q.all<{ id: number }>(`SELECT MIN(m.id) AS id FROM messages m WHERE m.date >= ? AND ${ELIGIBLE}
      GROUP BY ${DELIVERY_ID} ORDER BY MAX(m.date) DESC`, since).map((r) => r.id).filter((id) => this.connectorEligible(id));
  }

  backfillConnector(id: string, since: number, now: number): void {
    for (const messageId of this.connectorHistory(since)) {
      this.q.run(`INSERT INTO connector_deliveries (connection_id, message_id, message_row_id, created_at, next_attempt)
        SELECT ?, ${DELIVERY_ID}, m.id, ?, ? FROM messages m WHERE m.id = ?
        ON CONFLICT (connection_id, message_id) DO UPDATE SET state = 'pending', message_row_id = excluded.message_row_id,
          attempts = 0, first_attempt = NULL, created_at = excluded.created_at, next_attempt = excluded.next_attempt
        WHERE connector_deliveries.state = 'skipped'`, id, now, now, messageId);
    }
  }

  nextConnectorJob(): number | null {
    const r = this.q.get<{ due: number | null }>(`SELECT MIN(due) AS due FROM (
      SELECT MIN(d.next_attempt) AS due FROM connector_deliveries d JOIN connector_connections c ON c.id = d.connection_id
        WHERE d.state = 'pending' AND c.status = 'active'
      UNION ALL SELECT MIN(checked_at + ?) AS due FROM connector_connections WHERE status <> 'stopped')`, CONNECTOR_DAY);
    return r?.due ?? null;
  }

  connectorsToCheck(now: number): ConnectorConnection[] {
    return this.q.all<ConnectionRow>("SELECT * FROM connector_connections WHERE status <> 'stopped' AND checked_at <= ?", now - CONNECTOR_DAY).map(connection);
  }

  dueConnectorDeliveries(now: number): ConnectorDelivery[] {
    return this.q.all<ConnectorDelivery>(`SELECT d.* FROM connector_deliveries d JOIN connector_connections c ON c.id = d.connection_id
      WHERE d.state = 'pending' AND c.status = 'active' AND d.next_attempt <= ? ORDER BY d.next_attempt LIMIT 25`, now);
  }

  finishConnectorDelivery(d: ConnectorDelivery, state: "delivered" | "failed" | "skipped", now: number): void {
    const { changes } = this.q.run("UPDATE connector_deliveries SET state = ? WHERE connection_id = ? AND message_id = ? AND state = 'pending'", state, d.connection_id, d.message_id);
    if (state === "delivered" && changes) this.q.run("UPDATE connector_connections SET last_delivery = ?, delivered_count = delivered_count + 1 WHERE id = ?", now, d.connection_id);
  }

  /** The retry window starts when work begins, not while a new request waits for consent. */
  beginConnectorDelivery(d: ConnectorDelivery, now: number): void {
    if (d.first_attempt !== null) return;
    this.q.run("UPDATE connector_deliveries SET first_attempt = ? WHERE connection_id = ? AND message_id = ? AND first_attempt IS NULL", now, d.connection_id, d.message_id);
    d.first_attempt = now;
  }

  retryConnectorDelivery(d: ConnectorDelivery, now: number, retryAfterMs = 0): void {
    const deadline = (d.first_attempt ?? d.created_at) + CONNECTOR_DAY;
    if (now >= deadline) { this.finishConnectorDelivery(d, "failed", now); return; }
    const delay = Math.min(3_600_000, Math.max(retryAfterMs, 5_000 * 2 ** Math.min(d.attempts, 10)));
    const next = Math.min(deadline, now + delay);
    this.q.run("UPDATE connector_deliveries SET attempts = attempts + 1, next_attempt = ? WHERE connection_id = ? AND message_id = ? AND state = 'pending'", next, d.connection_id, d.message_id);
  }
}

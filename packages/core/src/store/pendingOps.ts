import type { AccountId, MessageRowId } from "../types";
import { parseJson, type Sql } from "./sql";

export type PendingKind = "seen" | "flagged" | "archive" | "trash" | "spam" | "unspam" | "move_inbox" | "move_folder";

/** What a server operation is, in a form that survives a restart. `arg` is the boolean or folder id the operation needs. */
export type PendingOpSpec = { kind: PendingKind; arg?: boolean | number };

export type PendingOp = {
  id: number; accountId: AccountId; kind: PendingKind; arg: boolean | number | null;
  messageIds: MessageRowId[]; createdAt: number; attempts: number;
};

type Row = { id: number; account_id: string; kind: string; arg: string | null; message_ids: string; created_at: number; attempts: number };

export class PendingOpsRepo {
  constructor(protected q: Sql) {}

  addPendingOp(accountId: AccountId, op: PendingOpSpec, messageIds: MessageRowId[], now: number = Date.now()): number {
    return this.q.run(
      "INSERT INTO pending_ops (account_id, kind, arg, message_ids, created_at) VALUES (?,?,?,?,?)",
      accountId, op.kind, op.arg === undefined ? null : JSON.stringify(op.arg), JSON.stringify(messageIds), now,
    ).lastInsertRowid;
  }

  removePendingOp(id: number): void {
    this.q.run("DELETE FROM pending_ops WHERE id = ?", id);
  }

  /** Records a failed replay and returns the attempts so far. */
  bumpPendingOp(id: number, error: string): number {
    this.q.run("UPDATE pending_ops SET attempts = attempts + 1, last_error = ? WHERE id = ?", error.slice(0, 300), id);
    return this.q.get<{ attempts: number }>("SELECT attempts FROM pending_ops WHERE id = ?", id)?.attempts ?? 0;
  }

  listPendingOps(): PendingOp[] {
    return this.q.all<Row>("SELECT * FROM pending_ops ORDER BY id").map((r) => ({
      id: r.id, accountId: r.account_id, kind: r.kind as PendingKind, arg: parseJson<boolean | number | null>(r.arg, null),
      messageIds: parseJson<number[]>(r.message_ids, []), createdAt: r.created_at, attempts: r.attempts,
    }));
  }
}

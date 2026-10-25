import type { Store } from "../store";

type Status = { tracked_id: number; email: string; status: string };

/** Small direct queries the client needs that the Store does not expose. */
export function countedOpens(store: Store): number {
  return (store.db.prepare("SELECT COUNT(*) AS n FROM receipt_events WHERE counted = 1").get() as { n: number }).n;
}

/** Status per `${trackedId}|${email}` for the recipients that own these tokens. */
export function statusesForTokens(store: Store, tokens: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const unique = [...new Set(tokens)];
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const rows = store.db
      .prepare(`SELECT tracked_id, email, status FROM tracked_recipients WHERE token IN (${chunk.map(() => "?").join(",")})`)
      .all(...chunk) as Status[];
    for (const r of rows) out.set(`${r.tracked_id}|${r.email}`, r.status);
  }
  return out;
}

export const statusKey = (trackedId: number, email: string): string => `${trackedId}|${email}`;

/** Recipient ids of one tracked message. */
export function recipientIds(store: Store, trackedId: number): number[] {
  return (store.db.prepare("SELECT id FROM tracked_recipients WHERE tracked_id = ?").all(trackedId) as { id: number }[]).map((r) => r.id);
}

/** Tracked ids whose thread is `threadId`. */
export function trackedIdsForThread(store: Store, threadId: number): number[] {
  return (store.db.prepare("SELECT id FROM tracked_messages WHERE thread_id = ?").all(threadId) as { id: number }[]).map((r) => r.id);
}

/** Records a reply from `email` on a tracked message sent before `at`. Returns the recipient id, or null when nothing matched. */
export function stampReply(store: Store, trackedId: number, email: string, at: number): number | null {
  const row = store.db
    .prepare(
      `SELECT r.id FROM tracked_recipients r JOIN tracked_messages t ON t.id = r.tracked_id
       WHERE r.tracked_id = ? AND r.email = ? AND r.replied_at IS NULL AND t.sent_at <= ?`,
    )
    .get(trackedId, email, at) as { id: number } | undefined;
  if (!row) return null;
  store.db.prepare("UPDATE tracked_recipients SET replied_at = ? WHERE id = ?").run(at, row.id);
  return row.id;
}

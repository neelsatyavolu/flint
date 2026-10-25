import type { Db } from "../db/open";

/**
 * Extra indexes the store's queries lean on. schema.ts is frozen, so they live here and the Store
 * constructor creates them if missing. Folded into a real migration by the integrator (see report).
 */
export const INDEX_STATEMENTS: readonly string[] = [
  "CREATE INDEX IF NOT EXISTS threads_account_last ON threads (account_id, last_date DESC)",
  "CREATE INDEX IF NOT EXISTS threads_pinned ON threads (pinned) WHERE pinned = 1",
  "CREATE INDEX IF NOT EXISTS threads_snoozed ON threads (snoozed_until) WHERE snoozed_until IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS messages_account_date ON messages (account_id, date)",
  "CREATE INDEX IF NOT EXISTS messages_reply ON messages (account_id, in_reply_to)",
  "CREATE INDEX IF NOT EXISTS messages_thread_seen ON messages (thread_id, seen)",
  "CREATE INDEX IF NOT EXISTS tracked_thread ON tracked_messages (thread_id)",
  "CREATE INDEX IF NOT EXISTS tracked_msgid ON tracked_messages (account_id, message_id)",
  "CREATE INDEX IF NOT EXISTS tracked_recipients_tracked ON tracked_recipients (tracked_id)",
  "CREATE INDEX IF NOT EXISTS receipt_events_recipient ON receipt_events (recipient_id, at)",
  "CREATE INDEX IF NOT EXISTS drafts_thread ON drafts (thread_id)",
  "CREATE INDEX IF NOT EXISTS reminders_due ON reminders (status, remind_at)",
  "CREATE INDEX IF NOT EXISTS folders_role ON folders (role, account_id)",
];

export function ensureIndexes(db: Db): void {
  for (const sql of INDEX_STATEMENTS) db.exec(sql);
}

// Follow-up reminders. Ported from RemindersRepo in store/library.ts.

import FlintModel
import Foundation
import GRDB

enum RemindersSQL {
    static func reminder(_ r: Row) -> Reminder {
        Reminder(
            id: r["id"], accountId: r["account_id"], threadId: r["thread_id"], messageId: r["message_id"], remindAt: r["remind_at"],
            status: ReminderStatus(rawValue: r["status"]) ?? .pending)
    }

    static func get(_ db: Database, _ id: Int) throws -> Reminder? {
        try db.first("SELECT * FROM reminders WHERE id = ?", id).map(reminder)
    }
}

extension GRDBStore: RemindersRepository {
    public func createReminder(accountId: AccountID, threadId: ThreadID?, messageId: String, remindAt: EpochMs) async throws -> Reminder {
        let id = cleanID(messageId) ?? messageId
        return try await write { db in
            let rowid = try db.insert("INSERT INTO reminders (account_id, thread_id, message_id, remind_at) VALUES (?,?,?,?)", accountId, threadId, id, remindAt)
            return try RemindersSQL.get(db, rowid)!
        }
    }

    public func reminder(id: Int) async throws -> Reminder? {
        try await read { db in try RemindersSQL.get(db, id) }
    }

    public func listDueReminders(now: EpochMs) async throws -> [Reminder] {
        try await read { db in
            try db.all("SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ? ORDER BY remind_at, id", now).map(RemindersSQL.reminder)
        }
    }

    public func nextReminderAt() async throws -> EpochMs? {
        try await read { db in try Int.fetchOne(db, sql: "SELECT MIN(remind_at) FROM reminders WHERE status = 'pending'") }
    }

    public func listPendingReminders(limit: Int) async throws -> [Reminder] {
        try await read { db in
            try db.all("SELECT * FROM reminders WHERE status = 'pending' ORDER BY remind_at, id LIMIT ?", limit).map(RemindersSQL.reminder)
        }
    }

    public func setReminderStatus(_ id: Int, _ status: ReminderStatus) async throws {
        try await write { db in try db.run("UPDATE reminders SET status = ? WHERE id = ?", status.rawValue, id) }
    }

    public func cancelReminders(accountId: AccountID, messageId: String) async throws {
        let id = cleanID(messageId) ?? messageId
        try await write { db in
            try db.run("UPDATE reminders SET status = 'cancelled' WHERE account_id = ? AND message_id = ? AND status = 'pending'", accountId, id)
        }
    }

    /// True when someone other than the user wrote in the thread after `since`. Decides fired versus replied.
    public func threadHasReply(_ threadId: ThreadID, since: EpochMs) async throws -> Bool {
        try await read { db in
            let own = try AccountsSQL.ownAddresses(db)
            let rows = try db.all("SELECT from_json FROM messages WHERE thread_id = ? AND date > ? AND draft = 0", threadId, since)
            return rows.contains { r in JSONColumn.addresses(r["from_json"]).contains { !own.contains(lowerAddress($0)) } }
        }
    }
}

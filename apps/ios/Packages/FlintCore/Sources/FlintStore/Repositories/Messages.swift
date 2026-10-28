// Message and thread reads for the reader and for IMAP actions. Ported from store/messages.ts.

import FlintModel
import Foundation
import GRDB

enum MessagesSQL {
    /// Local drafts whose send is queued (in its undo window, scheduled or going out) are no longer drafts to edit.
    static let notQueuedDraft = "NOT EXISTS (SELECT 1 FROM scheduled_sends s WHERE s.draft_id = drafts.id AND s.status IN ('pending','awaiting_approval','sending'))"

    static func stored(_ r: Row) -> StoredMessage {
        let headers = JSONColumn.decode(r["headers_json"], fallback: [String: String]())
        return StoredMessage(
            id: r["id"], accountId: r["account_id"], threadId: r["thread_id"], folderId: r["folder_id"], uid: r["uid"],
            gmMsgid: r["gm_msgid"], gmThrid: r["gm_thrid"], messageId: r["message_id"], inReplyTo: r["in_reply_to"],
            references: JSONColumn.decode(r["refs"], fallback: [String]()), subject: r["subject"], from: JSONColumn.addresses(r["from_json"]),
            to: JSONColumn.addresses(r["to_json"]), cc: JSONColumn.addresses(r["cc_json"]), bcc: JSONColumn.addresses(r["bcc_json"]),
            replyTo: JSONColumn.addresses(r["reply_to_json"]), date: r["date"], snippet: r["snippet"], seen: r.bool("seen"),
            flagged: r.bool("flagged"), answered: r.bool("answered"), draft: r.bool("draft"), hasAttachments: r.bool("has_attachments"),
            size: r["size"], headers: headers, bodyLoaded: (r["body_state"] as String) == "full", text: r["text_body"],
            rawHtml: r["html_body"], category: asCategory(r["category"]), unsubscribe: UnsubscribeParser.parse(headers))
    }

    private static func info(_ r: Row) -> AttachmentInfo {
        AttachmentInfo(
            id: r["id"], filename: r["filename"], contentType: r["content_type"], size: r["size"], inline: r.bool("inline"), contentId: r["content_id"])
    }

    static func attachment(_ db: Database, _ id: Int) throws -> StoredAttachment? {
        try db.first("SELECT * FROM attachments WHERE id = ?", id).map {
            StoredAttachment(info: info($0), messageRowId: $0["message_id"], part: $0["part"], cachedPath: $0["cached_path"])
        }
    }

    /// Folder/uid locations (with current label membership) of the given messages or of every message in the given threads.
    static func locations(_ db: Database, column: String, ids: [Int]) throws -> [MessageLocation] {
        var out: [MessageLocation] = []
        for part in ids.chunked() {
            let args: [SQLArg] = part
            let rows = try db.all(
                """
                SELECT m.id, m.thread_id, m.account_id, a.provider, m.folder_id, f.path, f.role, m.uid, m.gm_msgid, m.message_id, m.seen, m.flagged, m.answered
                FROM messages m JOIN folders f ON f.id = m.folder_id JOIN accounts a ON a.id = m.account_id
                WHERE \(column) IN (\(SQL.marks(part.count))) ORDER BY m.thread_id, m.date, m.id
                """, args: args)
            var members: [Int: [Int]] = [:]
            for chunk in rows.map({ $0["id"] as Int }).chunked() {
                let a: [SQLArg] = chunk
                for mf in try db.all("SELECT message_id, folder_id FROM message_folders WHERE message_id IN (\(SQL.marks(chunk.count))) ORDER BY folder_id", args: a) {
                    members[mf["message_id"] as Int, default: []].append(mf["folder_id"])
                }
            }
            for r in rows {
                let id: Int = r["id"]
                out.append(MessageLocation(
                    messageRowId: id, threadId: r["thread_id"], accountId: r["account_id"],
                    provider: MailProvider(rawValue: r["provider"]) ?? .imap, folderId: r["folder_id"], folderPath: r["path"],
                    folderRole: (r["role"] as String?).flatMap(MailboxRole.init(rawValue:)), uid: r["uid"], gmMsgid: r["gm_msgid"],
                    messageId: r["message_id"], seen: r.bool("seen"), flagged: r.bool("flagged"), answered: r.bool("answered"),
                    memberFolderIds: members[id] ?? []))
            }
        }
        return out
    }

    /// Thread plus its messages, oldest first, with attachments and parsed unsubscribe info. HTML is raw: the caller sanitizes.
    static func threadRows(_ db: Database, _ threadId: ThreadID) throws -> ThreadRows? {
        guard let t = try db.first("SELECT * FROM threads WHERE id = ?", threadId) else { return nil }
        let own = try AccountsSQL.ownAddresses(db)
        let every = try db.all("SELECT * FROM messages WHERE thread_id = ? ORDER BY date, id", threadId)
        // Server drafts are shown through draftIds and the composer, not as conversation messages, unless the thread has nothing else.
        let rows = every.contains { ($0["draft"] as Int) == 0 } ? every.filter { ($0["draft"] as Int) == 0 } : every
        var byMessage: [Int: [AttachmentInfo]] = [:]
        for a in try db.all("SELECT a.* FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.thread_id = ? ORDER BY a.id", threadId) {
            byMessage[a["message_id"] as Int, default: []].append(info(a))
        }
        let sentIds = Set(try db.all(
            """
            SELECT m.id FROM messages m JOIN folders f ON f.id = m.folder_id WHERE m.thread_id = ? AND f.role = 'sent'
            UNION SELECT mf.message_id FROM message_folders mf JOIN folders f ON f.id = mf.folder_id JOIN messages m ON m.id = mf.message_id
            WHERE m.thread_id = ? AND f.role = 'sent'
            """, threadId, threadId).map { $0["id"] as Int })
        let messages = rows.map { r -> StoredMessage in
            var m = stored(r)
            m.isFromMe = m.from.contains { own.contains(lowerAddress($0)) }
            m.inSent = sentIds.contains(m.id)
            m.attachments = byMessage[m.id] ?? []
            return m
        }
        let draftIds = try db.all("SELECT id FROM drafts WHERE thread_id = ? AND \(notQueuedDraft) ORDER BY id", threadId).map { $0["id"] as Int }
        return ThreadRows(
            id: t["id"], accountId: t["account_id"], subject: t["subject"], category: asCategory(t["category"]) ?? .people,
            pinned: t.bool("pinned"), muted: t.bool("muted"), snoozedUntil: t["snoozed_until"], resurfacedAt: t["resurfaced_at"],
            messages: messages, draftIds: draftIds)
    }
}

extension GRDBStore: MessagesRepository {
    public func message(id: MessageRowID) async throws -> StoredMessage? {
        try await read { db in try db.first("SELECT * FROM messages WHERE id = ?", id).map(MessagesSQL.stored) }
    }

    /// Every row with this Message-ID header in the account (a message can live in several folders).
    public func messages(accountId: AccountID, messageId: String) async throws -> [StoredMessage] {
        let id = cleanID(messageId) ?? messageId
        return try await read { db in
            try db.all("SELECT * FROM messages WHERE account_id = ? AND message_id = ? ORDER BY id", accountId, id).map(MessagesSQL.stored)
        }
    }

    public func message(folderId: FolderID, uid: Int) async throws -> StoredMessage? {
        try await read { db in try db.first("SELECT * FROM messages WHERE folder_id = ? AND uid = ?", folderId, uid).map(MessagesSQL.stored) }
    }

    public func attachment(id: Int) async throws -> StoredAttachment? {
        try await read { db in try MessagesSQL.attachment(db, id) }
    }

    public func setAttachmentCachedPath(_ id: Int, _ path: String?) async throws {
        try await write { db in try db.run("UPDATE attachments SET cached_path = ? WHERE id = ?", path, id) }
    }

    public func messageLocations(_ ids: [MessageRowID]) async throws -> [MessageLocation] {
        try await read { db in try MessagesSQL.locations(db, column: "m.id", ids: ids) }
    }

    /// Folder/uid locations of every message in the given threads: what the mail engine needs to run IMAP actions.
    public func threadLocations(_ threadIds: [ThreadID]) async throws -> [MessageLocation] {
        try await read { db in try MessagesSQL.locations(db, column: "m.thread_id", ids: threadIds) }
    }

    public func threadRows(_ threadId: ThreadID) async throws -> ThreadRows? {
        try await read { db in try MessagesSQL.threadRows(db, threadId) }
    }
}

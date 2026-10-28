// Local drafts and their server-copy metadata. Ported from DraftsRepo in store/drafts.ts.

import FlintModel
import Foundation
import GRDB

enum DraftsSQL {
    static func draft(_ r: Row) -> Draft {
        Draft(
            id: r["id"], accountId: r["account_id"], from: r["from_address"], mode: ComposeMode(rawValue: r["mode"]) ?? .new,
            sourceMessageId: r["source_message_id"], threadId: r["thread_id"], to: JSONColumn.addresses(r["to_json"]),
            cc: JSONColumn.addresses(r["cc_json"]), bcc: JSONColumn.addresses(r["bcc_json"]), subject: r["subject"], html: r["html"],
            quotedHtml: r["quoted_html"], attachments: JSONColumn.decode(r["attachments_json"], fallback: [DraftAttachment]()),
            signatureId: r["signature_id"], track: r.bool("track"), remindAt: r["remind_at"], createdBy: r["created_by"], updatedAt: r["updated_at"])
    }

    static func get(_ db: Database, _ id: Int) throws -> Draft? {
        try db.first("SELECT * FROM drafts WHERE id = ?", id).map(draft)
    }

    static func require(_ db: Database, _ id: Int) throws -> Draft {
        guard let d = try get(db, id) else { throw FlintError(.notFound, "That draft no longer exists.") }
        return d
    }

    static func create(_ db: Database, _ i: NewDraft, now: EpochMs) throws -> Draft {
        let id = try db.insert(
            """
            INSERT INTO drafts (account_id, from_address, mode, source_message_id, thread_id, to_json, cc_json, bcc_json, subject, html,
              quoted_html, attachments_json, signature_id, track, remind_at, in_reply_to, refs, created_by, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            i.accountId, i.from, i.mode.rawValue, i.sourceMessageId, i.threadId, JSONColumn.encode(i.to), JSONColumn.encode(i.cc),
            JSONColumn.encode(i.bcc), i.subject, i.html, i.quotedHtml, JSONColumn.encode(i.attachments), i.signatureId, i.track, i.remindAt,
            i.inReplyTo, JSONColumn.encode(i.references), i.createdBy, now)
        return try require(db, id)
    }

    static func update(_ db: Database, _ id: Int, _ p: DraftPatch, now: EpochMs) throws -> Draft {
        _ = try require(db, id)
        var sets: [String] = []
        var args: [SQLArg] = []
        func set(_ column: String, _ value: SQLArg) { sets.append("\(column) = ?"); args.append(value) }
        if let v = p.from { set("from_address", v) }
        if let v = p.accountId { set("account_id", v) }
        if let v = p.mode { set("mode", v.rawValue) }
        if let v = p.sourceMessageId { set("source_message_id", v) }
        if let v = p.threadId { set("thread_id", v) }
        if let v = p.to { set("to_json", JSONColumn.encode(v)) }
        if let v = p.cc { set("cc_json", JSONColumn.encode(v)) }
        if let v = p.bcc { set("bcc_json", JSONColumn.encode(v)) }
        if let v = p.subject { set("subject", v) }
        if let v = p.html { set("html", v) }
        if let v = p.quotedHtml { set("quoted_html", v) }
        if let v = p.attachments { set("attachments_json", JSONColumn.encode(v)) }
        if let v = p.signatureId { set("signature_id", v) }
        if let v = p.track { set("track", v) }
        if let v = p.remindAt { set("remind_at", v) }
        set("updated_at", now)
        try db.run("UPDATE drafts SET \(sets.joined(separator: ", ")) WHERE id = ?", args: args + [id])
        return try require(db, id)
    }

    static func meta(_ db: Database, _ id: Int) throws -> DraftMeta {
        guard let r = try db.first("SELECT in_reply_to, refs, server_uid, server_message_id FROM drafts WHERE id = ?", id) else {
            throw FlintError(.notFound, "That draft no longer exists.")
        }
        return DraftMeta(
            inReplyTo: r["in_reply_to"], references: JSONColumn.decode(r["refs"], fallback: [String]()),
            serverUid: r["server_uid"], serverMessageId: r["server_message_id"])
    }
}

extension GRDBStore: DraftsRepository {
    public func createDraft(_ input: NewDraft, now: EpochMs) async throws -> Draft {
        try await write { db in try DraftsSQL.create(db, input, now: now) }
    }

    public func draft(id: Int) async throws -> Draft? {
        try await read { db in try DraftsSQL.get(db, id) }
    }

    public func updateDraft(_ id: Int, _ patch: DraftPatch, now: EpochMs) async throws -> Draft {
        try await write { db in try DraftsSQL.update(db, id, patch, now: now) }
    }

    public func deleteDraft(_ id: Int) async throws {
        try await write { db in try db.run("DELETE FROM drafts WHERE id = ?", id) }
    }

    /// Newest edit first.
    public func listDrafts() async throws -> [Draft] {
        try await read { db in try db.all("SELECT * FROM drafts ORDER BY updated_at DESC, id DESC").map(DraftsSQL.draft) }
    }

    /// The local draft whose server Drafts copy is this message (same Message-ID, or the UID it was saved under).
    public func findDraft(accountId: AccountID, serverMessageId: String?, folderId: FolderID, uid: Int) async throws -> Draft? {
        try await read { db in
            try db.first(
                """
                SELECT * FROM drafts WHERE account_id = ? AND ((server_message_id IS NOT NULL AND server_message_id = ?)
                  OR (server_uid IS NOT NULL AND server_uid = ? AND ? IN (SELECT id FROM folders WHERE role = 'drafts'))) ORDER BY id LIMIT 1
                """,
                accountId, serverMessageId, uid, folderId).map(DraftsSQL.draft)
        }
    }

    public func listDrafts(threadId: ThreadID) async throws -> [Draft] {
        try await read { db in try db.all("SELECT * FROM drafts WHERE thread_id = ? ORDER BY id", threadId).map(DraftsSQL.draft) }
    }

    /// Reply headers and the server Drafts copy, which `Draft` does not carry.
    public func draftMeta(_ id: Int) async throws -> DraftMeta {
        try await read { db in try DraftsSQL.meta(db, id) }
    }

    public func setDraftMeta(_ id: Int, _ meta: DraftMeta) async throws {
        try await write { db in
            _ = try DraftsSQL.meta(db, id)
            try db.run(
                "UPDATE drafts SET in_reply_to = ?, refs = ?, server_uid = ?, server_message_id = ? WHERE id = ?",
                meta.inReplyTo, JSONColumn.encode(meta.references), meta.serverUid, meta.serverMessageId, id)
        }
    }
}

// Storing server messages: threading, rows, folder membership, attachments, search index, contacts, categories,
// blocked senders and rules. Ported from store/ingest.ts. One write transaction per batch.

import FlintModel
import Foundation
import GRDB

enum IngestSQL {
    /// The columns of an existing row that ingest compares and rewrites.
    struct Existing {
        var id: Int, threadId: Int, folderId: Int, uid: Int, category: String?, subject: String
        var fromJSON: String, toJSON: String, ccJSON: String, snippet: String

        init(_ r: Row) {
            id = r["id"]; threadId = r["thread_id"]; folderId = r["folder_id"]; uid = r["uid"]; category = r["category"]
            subject = r["subject"]; fromJSON = r["from_json"]; toJSON = r["to_json"]; ccJSON = r["cc_json"]; snippet = r["snippet"]
        }
    }

    static let existingColumns = "id, thread_id, folder_id, uid, category, subject, from_json, to_json, cc_json, snippet"

    final class Run {
        let account: Account
        let folder: Folder
        let own: Set<String>
        let evaluate: Bool
        let rules: [Rule]
        let blocked: Set<String>
        var folders: [String: (id: Int, role: String?)]
        var touched = Set<ThreadID>()
        let now: EpochMs

        init(account: Account, folder: Folder, own: Set<String>, evaluate: Bool, rules: [Rule], blocked: Set<String>, folders: [String: (id: Int, role: String?)], now: EpochMs) {
            self.account = account; self.folder = folder; self.own = own; self.evaluate = evaluate
            self.rules = rules; self.blocked = blocked; self.folders = folders; self.now = now
        }
    }

    static func folderMap(_ db: Database, _ accountId: AccountID) throws -> [String: (id: Int, role: String?)] {
        var out: [String: (id: Int, role: String?)] = [:]
        for f in try db.all("SELECT id, path, role FROM folders WHERE account_id = ?", accountId) { out[f["path"]] = (f["id"], f["role"]) }
        return out
    }

    /// Folder ids a message belongs to: the folder it was seen in plus (Gmail) its label folders, created on demand.
    static func membership(_ db: Database, _ accountId: AccountID, _ map: inout [String: (id: Int, role: String?)], seenIn: FolderID, labels: [String]?) throws -> [Int] {
        var ids: [Int] = [seenIn]
        for path in labels ?? [] {
            var f = map[path]
            if f == nil {
                let created = try FoldersSQL.upsert(db, accountId, FolderInput(path: path))
                f = (created.id, created.role?.rawValue)
                map[path] = f
            }
            if let f, !ids.contains(f.id) { ids.append(f.id) }
        }
        return ids
    }

    static func setMembership(_ db: Database, _ messageId: Int, _ folderIds: [Int]) throws {
        try db.run("DELETE FROM message_folders WHERE message_id = ?", messageId)
        for id in folderIds { try db.run("INSERT OR IGNORE INTO message_folders (message_id, folder_id) VALUES (?,?)", messageId, id) }
    }

    static func replaceAttachments(_ db: Database, _ messageId: Int, _ list: [IngestAttachment]) throws {
        try db.run("DELETE FROM attachments WHERE message_id = ?", messageId)
        for a in list {
            try db.run(
                "INSERT INTO attachments (message_id, part, filename, content_type, size, content_id, inline) VALUES (?,?,?,?,?,?,?)",
                messageId, a.part, a.filename, a.contentType, a.size, a.contentId, a.inline)
        }
        try db.run("UPDATE messages SET has_attachments = ? WHERE id = ?", list.contains { !$0.inline }, messageId)
    }

    static func writeBody(_ db: Database, _ row: Existing, text: String?, html: String?) throws {
        let body = PlainText.bodyText(text: text, html: html)
        let snippet = row.snippet.isEmpty ? PlainText.snippet(from: body) : row.snippet
        try db.run("UPDATE messages SET text_body = ?, html_body = ?, body_state = 'full', snippet = ? WHERE id = ?", text, html, snippet, row.id)
        try Rollup.writeFTS(
            db, rowid: row.id, subject: row.subject, from: JSONColumn.addresses(row.fromJSON), to: JSONColumn.addresses(row.toJSON),
            cc: JSONColumn.addresses(row.ccJSON), body: body)
    }

    // MARK: Batch

    static func ingest(
        _ db: Database, classifier: any MailClassifier, accountId: AccountID, folderId: FolderID, items: [IngestMessage],
        context: IngestContext, clock: EpochMs
    ) throws -> [IngestOutcome] {
        let account = try AccountsSQL.require(db, accountId)
        let folder = try FoldersSQL.require(db, folderId)
        if folder.accountId != accountId { throw FlintError(.invalid, "That folder belongs to a different account.") }
        let evaluate = context.evaluate
        let run = Run(
            account: account, folder: folder, own: try AccountsSQL.ownAddresses(db), evaluate: evaluate,
            rules: evaluate ? try RulesSQL.list(db, accountId: accountId) : [],
            blocked: evaluate ? try RulesSQL.blockedPatterns(db) : [], folders: try folderMap(db, accountId), now: context.now ?? clock)
        var outcomes = try items.map { try ingestOne(db, classifier, run, $0) }
        try Rollup.recomputeThreads(db, run.touched)
        try attachReceiptChanges(db, run, &outcomes)
        return outcomes
    }

    private static func attachReceiptChanges(_ db: Database, _ run: Run, _ outcomes: inout [IngestOutcome]) throws {
        var seen = Set<ThreadID>()
        for i in outcomes.indices.reversed() {
            let o = outcomes[i]
            if !o.isNew || o.fromMe || !seen.insert(o.threadId).inserted { continue }
            outcomes[i].receiptChanges = try ReceiptsSQL.recompute(db, threadId: o.threadId, now: run.now)
        }
    }

    private static func findExisting(_ db: Database, _ run: Run, _ item: IngestMessage, messageId: String?) throws -> Existing? {
        if run.account.provider == .gmail, let gm = item.gmMsgid {
            if let r = try db.first("SELECT \(existingColumns) FROM messages WHERE account_id = ? AND gm_msgid = ?", run.account.id, gm) { return Existing(r) }
        }
        let byUid = try db.first("SELECT \(existingColumns) FROM messages WHERE folder_id = ? AND uid = ?", run.folder.id, item.uid).map(Existing.init)
        if byUid != nil || run.account.provider == .gmail { return byUid }
        guard let messageId else { return nil }
        // Optimistic local move: the row still points at the source folder but is already a member of this one.
        let cols = existingColumns.components(separatedBy: ", ").map { "m.\($0)" }.joined(separator: ", ")
        return try db.first(
            """
            SELECT \(cols) FROM messages m JOIN message_folders mf ON mf.message_id = m.id
            WHERE m.account_id = ? AND m.message_id = ? AND mf.folder_id = ? AND m.folder_id <> ? LIMIT 1
            """,
            run.account.id, messageId, run.folder.id, run.folder.id).map(Existing.init)
    }

    private static func ingestOne(_ db: Database, _ classifier: any MailClassifier, _ run: Run, _ item: IngestMessage) throws -> IngestOutcome {
        var msg = item
        msg.messageId = cleanID(item.messageId)
        msg.inReplyTo = cleanID(item.inReplyTo)
        msg.references = item.references.compactMap(cleanID)
        let fromMe = msg.from.contains { run.own.contains(lowerAddress($0)) }
        if let existing = try findExisting(db, run, msg, messageId: msg.messageId) {
            return try updateExisting(db, run, existing, msg, fromMe: fromMe)
        }
        return try insertNew(db, classifier, run, msg, fromMe: fromMe)
    }

    private static func updateExisting(_ db: Database, _ run: Run, _ row: Existing, _ msg: IngestMessage, fromMe: Bool) throws -> IngestOutcome {
        let gmail = run.account.provider == .gmail
        let moved = row.folderId != run.folder.id || row.uid != msg.uid
        if moved,
           let clash = try Int.fetchOne(db, sql: "SELECT id FROM messages WHERE folder_id = ? AND uid = ? AND id <> ?", arguments: [run.folder.id, msg.uid, row.id]) {
            for t in try Rollup.deleteMessages(db, [clash]) { run.touched.insert(t) }
        }
        try db.run(
            """
            UPDATE messages SET folder_id = ?, uid = ?, gm_msgid = COALESCE(?, gm_msgid), gm_thrid = COALESCE(?, gm_thrid),
              seen = ?, flagged = ?, answered = ?, draft = ?, has_attachments = ?, size = ? WHERE id = ?
            """,
            run.folder.id, msg.uid, msg.gmMsgid, msg.gmThrid, msg.flags.seen, msg.flags.flagged, msg.flags.answered, msg.flags.draft,
            msg.hasAttachments, msg.size, row.id)
        if !msg.headers.isEmpty { try db.run("UPDATE messages SET headers_json = ? WHERE id = ?", JSONColumn.encode(msg.headers), row.id) }
        if msg.textBody != nil || msg.htmlBody != nil { try writeBody(db, row, text: msg.textBody, html: msg.htmlBody) }
        if !msg.attachments.isEmpty, try db.count("SELECT COUNT(*) FROM attachments WHERE message_id = ?", row.id) == 0 {
            try replaceAttachments(db, row.id, msg.attachments)
        }
        let labels = gmail ? msg.gmLabels : nil
        var folders = run.folders
        if labels != nil || moved {
            try setMembership(db, row.id, try membership(db, run.account.id, &folders, seenIn: run.folder.id, labels: labels))
            run.folders = folders
        } else {
            try db.run("INSERT OR IGNORE INTO message_folders (message_id, folder_id) VALUES (?,?)", row.id, run.folder.id)
        }
        run.touched.insert(row.threadId)
        return IngestOutcome(
            uid: msg.uid, messageRowId: row.id, threadId: row.threadId, isNew: false, category: asCategory(row.category) ?? .people, fromMe: fromMe)
    }

    private static func insertNew(_ db: Database, _ classifier: any MailClassifier, _ run: Run, _ msg: IngestMessage, fromMe: Bool) throws -> IngestOutcome {
        let sender = msg.from.first
        let resolved = try ThreadResolve.resolve(db, accountId: run.account.id, folderId: run.folder.id, msg: msg, own: run.own)
        let known = try fromMe || (sender.map { try ContactsSQL.hasSentTo(db, $0.address) } ?? false)
        var category = classifier.category(from: sender, headers: msg.headers, isKnownContact: known, subject: msg.subject)
        let hasBody = msg.textBody != nil || msg.htmlBody != nil
        let bodyText = hasBody ? PlainText.bodyText(text: msg.textBody, html: msg.htmlBody) : ""
        let snippet = msg.snippet ?? PlainText.snippet(from: bodyText)

        let id = try db.insert(
            """
            INSERT INTO messages (account_id, thread_id, folder_id, uid, gm_msgid, gm_thrid, message_id, in_reply_to, refs, subject,
              from_json, to_json, cc_json, bcc_json, reply_to_json, date, snippet, seen, flagged, answered, draft,
              has_attachments, size, headers_json, body_state, text_body, html_body, category)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            run.account.id, resolved.threadId, run.folder.id, msg.uid, msg.gmMsgid, msg.gmThrid, msg.messageId, msg.inReplyTo,
            JSONColumn.encode(msg.references), msg.subject, JSONColumn.encode(msg.from), JSONColumn.encode(msg.to), JSONColumn.encode(msg.cc),
            JSONColumn.encode(msg.bcc), JSONColumn.encode(msg.replyTo), msg.date, snippet, msg.flags.seen, msg.flags.flagged, msg.flags.answered,
            msg.flags.draft, msg.hasAttachments, msg.size, JSONColumn.encode(msg.headers), hasBody ? "full" : "none", msg.textBody, msg.htmlBody,
            category.rawValue)

        let labels = run.account.provider == .gmail ? msg.gmLabels : nil
        var folders = run.folders
        let memberIds = try membership(db, run.account.id, &folders, seenIn: run.folder.id, labels: labels)
        run.folders = folders
        try setMembership(db, id, memberIds)
        if !msg.attachments.isEmpty { try replaceAttachments(db, id, msg.attachments) }
        try Rollup.writeFTS(db, rowid: id, subject: msg.subject, from: msg.from, to: msg.to, cc: msg.cc, body: bodyText)

        if !msg.flags.draft { try updateContacts(db, run, msg, fromMe: fromMe) }
        if fromMe, let mid = msg.messageId {
            try ReceiptsSQL.linkSent(db, accountId: run.account.id, ref: msg.headers["x-flint-ref"], messageId: mid, threadId: resolved.threadId)
        }

        var blocked = false
        var actions: [RuleAction] = []
        if run.evaluate && !fromMe && !msg.flags.draft {
            blocked = sender.map { RulesSQL.senderMatchesBlocked($0.address, run.blocked) } ?? false
            let inbox = memberIds.contains { fid in run.folders.values.contains { $0.id == fid && $0.role == MailboxRole.inbox.rawValue } }
            if !blocked && inbox {
                actions = classifier.ruleActions(
                    rules: run.rules, accountId: run.account.id, from: msg.from, to: msg.to, cc: msg.cc, bcc: msg.bcc,
                    subject: msg.subject, body: bodyText, headers: msg.headers, hasAttachments: msg.hasAttachments)
                var resolvedCategory = category
                for case .category(let c) in actions { resolvedCategory = c }
                if resolvedCategory != category {
                    category = resolvedCategory
                    try db.run("UPDATE messages SET category = ?, category_source = 'rule' WHERE id = ?", category.rawValue, id)
                }
                if actions.contains(.mute) { try db.run("UPDATE threads SET muted = 1 WHERE id = ?", resolved.threadId) }
            }
        }
        run.touched.insert(resolved.threadId)
        return IngestOutcome(
            uid: msg.uid, messageRowId: id, threadId: resolved.threadId, isNew: true, category: category, fromMe: fromMe, blocked: blocked,
            ruleActions: actions, mergedThreadIds: resolved.mergedThreadIds)
    }

    private static func updateContacts(_ db: Database, _ run: Run, _ msg: IngestMessage, fromMe: Bool) throws {
        if fromMe {
            for a in msg.to + msg.cc + msg.bcc where !run.own.contains(lowerAddress(a)) { try ContactsSQL.touch(db, a, date: msg.date, sent: true) }
        } else {
            for a in msg.from { try ContactsSQL.touch(db, a, date: msg.date, sent: false) }
        }
    }

    // MARK: Flags, labels, expunges

    static func applyFlags(_ db: Database, folderId: FolderID, updates: [FlagUpdate]) throws -> [ThreadID] {
        var changed: [ThreadID] = []
        var pinChanged = Set<ThreadID>()
        for u in updates {
            guard let r = try db.first("SELECT id, thread_id, seen, flagged, answered, draft FROM messages WHERE folder_id = ? AND uid = ?", folderId, u.uid) else { continue }
            let cur = (seen: r.bool("seen"), flagged: r.bool("flagged"), answered: r.bool("answered"), draft: r.bool("draft"))
            let next = (seen: u.seen ?? cur.seen, flagged: u.flagged ?? cur.flagged, answered: u.answered ?? cur.answered, draft: u.draft ?? cur.draft)
            if next == cur { continue }
            let threadId: Int = r["thread_id"]
            try db.run("UPDATE messages SET seen = ?, flagged = ?, answered = ?, draft = ? WHERE id = ?", next.seen, next.flagged, next.answered, next.draft, r["id"] as Int)
            if !changed.contains(threadId) { changed.append(threadId) }
            if next.flagged != cur.flagged { pinChanged.insert(threadId) }
        }
        try Rollup.recomputeThreads(db, pinChanged.sorted())
        return changed
    }

    static func applyGmailLabels(_ db: Database, folderId: FolderID, updates: [(uid: Int, labels: [String])]) throws -> [ThreadID] {
        let folder = try FoldersSQL.require(db, folderId)
        var map = try folderMap(db, folder.accountId)
        var changed: [ThreadID] = []
        for u in updates {
            guard let r = try db.first("SELECT id, thread_id FROM messages WHERE folder_id = ? AND uid = ?", folderId, u.uid) else { continue }
            let next = try membership(db, folder.accountId, &map, seenIn: folderId, labels: u.labels)
            let id: Int = r["id"]
            let cur = try db.all("SELECT folder_id FROM message_folders WHERE message_id = ?", id).map { $0["folder_id"] as Int }
            if cur.count == next.count && next.allSatisfy(cur.contains) { continue }
            try setMembership(db, id, next)
            let t: Int = r["thread_id"]
            if !changed.contains(t) { changed.append(t) }
        }
        return changed
    }

    static func removeUids(_ db: Database, folderId: FolderID, uids: [Int]) throws -> [ThreadID] {
        var ids: [Int] = []
        for part in uids.chunked() {
            let args: [SQLArg] = [folderId] + part
            ids += try db.all("SELECT id FROM messages WHERE folder_id = ? AND uid IN (\(SQL.marks(part.count)))", args: args).map { $0["id"] as Int }
        }
        return try Rollup.deleteMessages(db, ids)
    }
}

extension GRDBStore: IngestRepository {
    /// Stores messages, resolves threads (merging where headers connect them), categorizes, evaluates rules and blocks.
    public func ingestMessages(_ accountId: AccountID, _ folderId: FolderID, _ items: [IngestMessage], context: IngestContext) async throws -> [IngestOutcome] {
        let classifier = self.classifier
        let now = clock()
        return try await write { db in
            try IngestSQL.ingest(db, classifier: classifier, accountId: accountId, folderId: folderId, items: items, context: context, clock: now)
        }
    }

    public func setBody(_ messageRowId: MessageRowID, _ body: MessageBody) async throws {
        try await write { db in
            guard let r = try db.first("SELECT \(IngestSQL.existingColumns) FROM messages WHERE id = ?", messageRowId) else {
                throw FlintError(.notFound, "That message no longer exists.")
            }
            try IngestSQL.writeBody(db, IngestSQL.Existing(r), text: body.text, html: body.html)
            if let attachments = body.attachments { try IngestSQL.replaceAttachments(db, messageRowId, attachments) }
        }
    }

    /// Returns the threads whose flags changed.
    public func applyFlags(_ folderId: FolderID, _ updates: [FlagUpdate]) async throws -> [ThreadID] {
        try await write { db in try IngestSQL.applyFlags(db, folderId: folderId, updates: updates) }
    }

    /// Gmail: replaces label membership (labels as folder paths).
    public func applyGmailLabels(_ folderId: FolderID, _ updates: [(uid: Int, labels: [String])]) async throws -> [ThreadID] {
        try await write { db in try IngestSQL.applyGmailLabels(db, folderId: folderId, updates: updates) }
    }

    /// The server expunged these UIDs from the folder. Returns affected thread ids.
    public func removeUids(_ folderId: FolderID, _ uids: [Int]) async throws -> [ThreadID] {
        try await write { db in try IngestSQL.removeUids(db, folderId: folderId, uids: uids) }
    }

    public func listLocalUids(_ folderId: FolderID, minUid: Int) async throws -> [Int] {
        try await read { db in
            try db.all("SELECT uid FROM messages WHERE folder_id = ? AND uid >= ? ORDER BY uid", folderId, minUid).map { $0["uid"] as Int }
        }
    }
}

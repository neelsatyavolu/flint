// Local drafts as rows of the Drafts list. Ported from store/draftList.ts.

import FlintModel
import Foundation
import GRDB

enum DraftList {
    static let noSubject = "(No subject)"

    struct Entry {
        var key: Int
        var id: Int
        var item: ThreadListItem
    }

    /// Id a local draft carries in the Drafts list. Negative, so it never collides with a thread id.
    static func rowID(_ draftId: Int) -> Int { -draftId }

    /// Every local draft as a Drafts-list row. `accountId` narrows to one account.
    static func localEntries(_ db: Database, accountId: AccountID?) throws -> [Entry] {
        let rows = try accountId.map { try db.all("SELECT * FROM drafts WHERE account_id = ? AND \(MessagesSQL.notQueuedDraft)", $0) }
            ?? db.all("SELECT * FROM drafts WHERE \(MessagesSQL.notQueuedDraft)")
        return rows.map { r in
            let people = JSONColumn.addresses(r["to_json"]) + JSONColumn.addresses(r["cc_json"]) + JSONColumn.addresses(r["bcc_json"])
            let draftId: Int = r["id"]
            let id = rowID(draftId)
            let subject = (r["subject"] as String).trimmingCharacters(in: .whitespacesAndNewlines)
            let updated: Int = r["updated_at"]
            let attachments = JSONColumn.decode(r["attachments_json"], fallback: [JSONValue]())
            return Entry(key: updated, id: id, item: ThreadListItem(
                id: id, accountId: r["account_id"], subject: subject.isEmpty ? noSubject : subject, snippet: PlainText.draftSnippet(html: r["html"]),
                participants: people, lastDate: updated, messageCount: 1, unreadCount: 0, hasAttachments: !attachments.isEmpty,
                category: .people, hasDraft: true, draft: DraftRef(draftId: draftId, messageId: nil)))
        }
    }
}

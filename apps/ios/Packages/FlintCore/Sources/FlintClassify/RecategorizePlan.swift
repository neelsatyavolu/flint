import Foundation
import FlintModel

/// A stored received message as the categorizer needs it. The store supplies rows where `draft = 0` and
/// `category_source IS NULL` (nothing a rule or the user decided); this plan never overrides a decided category.
public struct RecategorizeRow: Hashable, Sendable {
    public var messageId: MessageRowID
    public var threadId: ThreadID
    public var subject: String
    public var from: Address?
    public var headers: [String: String]
    public var category: MailCategory?

    public init(messageId: MessageRowID, threadId: ThreadID, subject: String, from: Address?, headers: [String: String], category: MailCategory?) {
        self.messageId = messageId
        self.threadId = threadId
        self.subject = subject
        self.from = from
        self.headers = headers
        self.category = category
    }
}

public struct RecategorizeChange: Hashable, Sendable {
    public var messageId: MessageRowID
    public var threadId: ThreadID
    public var category: MailCategory
}

/// What `Store.recategorizeAll` applies: the messages whose category changes and the threads to roll up again.
public struct RecategorizePlan: Hashable, Sendable {
    public var changes: [RecategorizeChange]
    public var touchedThreads: Set<ThreadID>
    public var changed: Int { changes.count }

    /// True when mail was labelled by an older categorizer (stored version below `categorizerVersion`).
    public static func isStale(storedVersion: Int?) -> Bool { (storedVersion ?? 0) < categorizerVersion }

    /// Port of `RecategorizeRepo.recategorizeAll` minus the SQL. `ownAddresses` are the user's accounts and aliases
    /// (lowercase): their mail keeps its category. `knownContacts` are lowercase addresses with `sent_count > 0`.
    public static func make(rows: [RecategorizeRow], ownAddresses: Set<String>, knownContacts: Set<String>) -> RecategorizePlan {
        var changes: [RecategorizeChange] = []
        var touched: Set<ThreadID> = []
        for r in rows {
            let address = (r.from?.address ?? "").lowercased()
            if ownAddresses.contains(address) { continue }
            let next = Categorizer.categorize(CategorizeInput(from: r.from, headers: r.headers, isKnownContact: knownContacts.contains(address), subject: r.subject))
            if let current = r.category, current == next { continue }
            changes.append(RecategorizeChange(messageId: r.messageId, threadId: r.threadId, category: next))
            touched.insert(r.threadId)
        }
        return RecategorizePlan(changes: changes, touchedThreads: touched)
    }
}

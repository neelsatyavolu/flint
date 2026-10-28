// Receipt status derivation (SPEC section 6). Ported from packages/core/src/store/receiptStatus.ts and the per-recipient
// part of ReceiptsRepo.recomputeRecipient; shared fixture: receipts-status.json.

import FlintModel
import Foundation

public enum ReceiptStatusLogic {
    public static let forwardGapMs = 60 * 60 * 1000
    public static let prefetchNote = "Apple Mail Privacy Protection loads images for every message, so opens can't be confirmed"
    public static let unregisteredNote = "Receipts unavailable for this message"

    /// One service event for a recipient. Only `.open` counts; any `.prefetch` marks the recipient unknowable.
    public struct Event: Hashable, Sendable {
        public var at: EpochMs
        public var kind: ReceiptEventKind
        public var client: String?
        public var fingerprint: String?

        public init(at: EpochMs, kind: ReceiptEventKind, client: String? = nil, fingerprint: String? = nil) {
            self.at = at
            self.kind = kind
            self.client = client
            self.fingerprint = fingerprint
        }
    }

    public struct Derived: Hashable, Sendable {
        public var status: ReceiptStatus
        public var openCount: Int
        public var firstOpenAt: EpochMs?
        public var lastOpenAt: EpochMs?
        public var note: String?
        public var possiblyForwarded: Bool
    }

    /// A counted open whose fingerprint and client both differ from the first counted open, more than an hour later,
    /// suggests the message was forwarded.
    static func isPossiblyForwarded(_ opens: [Event]) -> Bool {
        if opens.count < 2 { return false }
        let sorted = opens.sorted { $0.at < $1.at }
        let first = sorted[0]
        return sorted.dropFirst().contains { $0.at - first.at > forwardGapMs && $0.fingerprint != first.fingerprint && $0.client != first.client }
    }

    /// replied > opened > unknowable > sent. `.untracked` only when nothing else is known and the message was not registered.
    static func status(openCount: Int, repliedAt: EpochMs?, sawPrefetch: Bool, registered: Bool) -> ReceiptStatus {
        if repliedAt != nil { return .replied }
        if openCount > 0 { return .opened }
        if !registered { return .untracked }
        if sawPrefetch { return .unknowable }
        return .sent
    }

    static func note(status: ReceiptStatus, registered: Bool, untrackedReason: String?) -> String? {
        if status == .unknowable { return prefetchNote }
        if status == .untracked && !registered { return untrackedReason ?? unregisteredNote }
        return nil
    }

    public static func derive(events: [Event], repliedAt: EpochMs?, registered: Bool, untrackedReason: String?) -> Derived {
        let counted = events.filter { $0.kind == .open }.sorted { $0.at < $1.at }
        let s = status(openCount: counted.count, repliedAt: repliedAt, sawPrefetch: events.contains { $0.kind == .prefetch }, registered: registered)
        return Derived(
            status: s, openCount: counted.count, firstOpenAt: counted.first?.at, lastOpenAt: counted.last?.at,
            note: note(status: s, registered: registered, untrackedReason: untrackedReason), possiblyForwarded: isPossiblyForwarded(counted))
    }

    public static func summarize(_ recipients: [(status: ReceiptStatus, lastOpenAt: EpochMs?)]) -> ReceiptSummary {
        let opened = recipients.filter { $0.status == .opened || $0.status == .replied }.count
        let lastOpenAt = recipients.compactMap(\.lastOpenAt).max()
        var status = ReceiptStatus.sent
        if recipients.contains(where: { $0.status == .replied }) { status = .replied }
        else if opened > 0 { status = .opened }
        else if !recipients.isEmpty && recipients.allSatisfy({ $0.status == .untracked }) { status = .untracked }
        else if recipients.contains(where: { $0.status == .unknowable }) && recipients.allSatisfy({ $0.status == .unknowable || $0.status == .untracked }) { status = .unknowable }
        return ReceiptSummary(opened: opened, total: recipients.count, status: status, lastOpenAt: lastOpenAt)
    }
}

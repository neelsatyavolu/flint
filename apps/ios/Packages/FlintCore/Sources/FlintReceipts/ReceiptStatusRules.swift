import FlintModel

/// Receipt status derivation (port of packages/core/src/store/receiptStatus.ts).
/// The store calls these when it recomputes a recipient, so the rules live in one place.
public enum ReceiptStatusRules {
    /// A counted open that differs in client and fingerprint, arriving later than this after the first, suggests a forward.
    public static let forwardGapMs = 60 * 60 * 1000
    public static let prefetchNote = "Apple Mail Privacy Protection loads images for every message, so opens can't be confirmed"
    public static let unregisteredNote = "Receipts unavailable for this message"

    public struct CountedOpen: Sendable, Hashable {
        public var at: EpochMs
        public var fingerprint: String?
        public var client: String?

        public init(at: EpochMs, fingerprint: String? = nil, client: String? = nil) {
            self.at = at
            self.fingerprint = fingerprint
            self.client = client
        }
    }

    public struct RecipientSignals: Sendable, Hashable {
        public var openCount: Int
        public var repliedAt: EpochMs?
        public var sawPrefetch: Bool
        /// False when tracking never registered (service unreachable) or was turned off.
        public var registered: Bool

        public init(openCount: Int, repliedAt: EpochMs?, sawPrefetch: Bool, registered: Bool) {
            self.openCount = openCount
            self.repliedAt = repliedAt
            self.sawPrefetch = sawPrefetch
            self.registered = registered
        }
    }

    public struct RecipientSnapshot: Sendable, Hashable {
        public var status: ReceiptStatus
        public var lastOpenAt: EpochMs?

        public init(status: ReceiptStatus, lastOpenAt: EpochMs?) {
            self.status = status
            self.lastOpenAt = lastOpenAt
        }
    }

    public static func isPossiblyForwarded(_ opens: [CountedOpen]) -> Bool {
        guard opens.count >= 2 else { return false }
        let sorted = opens.sorted { $0.at < $1.at }
        let first = sorted[0]
        return sorted.dropFirst().contains { $0.at - first.at > forwardGapMs && $0.fingerprint != first.fingerprint && $0.client != first.client }
    }

    /// replied > opened > unknowable > sent. `untracked` only when nothing else is known and the message was not registered.
    public static func recipientStatus(_ s: RecipientSignals) -> ReceiptStatus {
        if s.repliedAt != nil { return .replied }
        if s.openCount > 0 { return .opened }
        if !s.registered { return .untracked }
        if s.sawPrefetch { return .unknowable }
        return .sent
    }

    public static func recipientNote(_ status: ReceiptStatus, registered: Bool, untrackedReason: String? = nil) -> String? {
        if status == .unknowable { return prefetchNote }
        if status == .untracked && !registered { return untrackedReason ?? unregisteredNote }
        return nil
    }

    public static func summarize(_ recipients: [RecipientSnapshot]) -> ReceiptSummary {
        let opened = recipients.filter { $0.status == .opened || $0.status == .replied }.count
        let lastOpenAt = recipients.compactMap(\.lastOpenAt).max()
        var status = ReceiptStatus.sent
        if recipients.contains(where: { $0.status == .replied }) {
            status = .replied
        } else if opened > 0 {
            status = .opened
        } else if !recipients.isEmpty && recipients.allSatisfy({ $0.status == .untracked }) {
            status = .untracked
        } else if recipients.contains(where: { $0.status == .unknowable }) && recipients.allSatisfy({ $0.status == .unknowable || $0.status == .untracked }) {
            status = .unknowable
        }
        return ReceiptSummary(opened: opened, total: recipients.count, status: status, lastOpenAt: lastOpenAt)
    }
}

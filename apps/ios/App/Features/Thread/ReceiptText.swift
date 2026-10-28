import FlintModel
import Foundation

/// The words for the check beside a sent message, after the desktop `state/receiptText.ts`. The per-recipient lines live in
/// `Features/Receipts` (`ReceiptStatusText`).
enum ReceiptText {
    /// The recipients the receipt covers. Untracked ones (tracking off, or the person themselves) are left out.
    static func tracked(_ detail: ReceiptDetail) -> [ReceiptRecipient] {
        detail.recipients.filter { $0.status != .untracked }
    }

    static func summary(_ detail: ReceiptDetail, now: Date = Date()) -> String {
        let people = tracked(detail)
        guard !people.isEmpty else { return String(localized: "Not tracked", table: "Thread") }
        if people.contains(where: { $0.status == .replied }) { return String(localized: "Replied", table: "Thread") }
        let opened = people.filter { $0.status == .opened }
        if let first = opened.first {
            if people.count == 1 {
                let when = first.firstOpenAt.map { FlintTime.current.ago($0, now: now) } ?? ""
                return when.isEmpty ? String(localized: "Opened", table: "Thread") : String(localized: "Opened \(when)", table: "Thread")
            }
            return String(localized: "Opened by \(opened.count) of \(people.count)", table: "Thread")
        }
        if people.allSatisfy({ $0.status == .unknowable }) { return String(localized: "Can't tell if it was opened", table: "Thread") }
        return String(localized: "Not opened yet", table: "Thread")
    }

    /// Opened or replied: the check turns accent colored.
    static func isSeen(_ detail: ReceiptDetail) -> Bool {
        tracked(detail).contains { $0.status == .opened || $0.status == .replied }
    }
}

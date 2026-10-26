import FlintModel
import Foundation

/// The words for a sent message's read receipt, after the desktop `state/receiptText.ts`. Receipts are a placeholder row on
/// iOS for now: one line of summary and one line per tracked recipient.
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

    static func line(_ recipient: ReceiptRecipient, now: Date = Date()) -> String {
        let name = FlintFormat.displayName(Address(name: recipient.name, address: recipient.email))
        switch recipient.status {
        case .replied:
            let when = recipient.repliedAt.map { FlintTime.current.ago($0, now: now) } ?? ""
            return String(localized: "\(name): replied \(when)", table: "Thread")
        case .opened:
            let when = recipient.firstOpenAt.map { FlintTime.current.ago($0, now: now) } ?? ""
            return String(localized: "\(name): opened \(when)", table: "Thread")
        case .unknowable: return String(localized: "\(name): can't tell", table: "Thread")
        case .sent: return String(localized: "\(name): not opened yet", table: "Thread")
        case .untracked: return String(localized: "\(name): not tracked", table: "Thread")
        }
    }

    /// Opened or replied: the check turns accent colored.
    static func isSeen(_ detail: ReceiptDetail) -> Bool {
        tracked(detail).contains { $0.status == .opened || $0.status == .replied }
    }
}

import FlintModel
import FlintReceipts
import Foundation

/// Which recipients a sent message's read status lists. Tracking never covers your own addresses, so the service leaves them
/// out of the receipt; this puts them back as untracked so the list matches the To and Cc lines.
enum ReceiptRows {
    static func recipients(receipt: ReceiptDetail?, to: [Address], cc: [Address], selfAddresses: [String]) -> [ReceiptRecipient] {
        let own = Set(selfAddresses.map(ReceiptPixel.canonicalAddress))
        let visible = to + cc
        let ownHere = visible.filter { own.contains(ReceiptPixel.canonicalAddress($0.address)) }
        guard let receipt else {
            // No receipt: only claim something when every recipient is you, so the reason is known.
            let everyoneIsMe = !visible.isEmpty && ownHere.count == visible.count
            return everyoneIsMe ? untracked(ownHere, skipping: []) : []
        }
        let known = Set(receipt.recipients.map { ReceiptPixel.canonicalAddress($0.email) })
        return receipt.recipients + untracked(ownHere, skipping: known)
    }

    private static func untracked(_ addresses: [Address], skipping known: Set<String>) -> [ReceiptRecipient] {
        var seen = known
        return addresses.compactMap { address in
            guard seen.insert(ReceiptPixel.canonicalAddress(address.address)).inserted else { return nil }
            return ReceiptRecipient(email: address.address, name: address.name, status: .untracked)
        }
    }
}

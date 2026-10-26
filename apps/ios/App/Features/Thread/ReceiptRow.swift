import FlintModel
import SwiftUI

/// A small check beside the sender of a tracked message you sent: accent once somebody opened or replied.
struct MessageReceiptCheck: View {
    let receipt: ReceiptDetail

    var body: some View {
        FlintIconView(icon: .check, size: 12, color: ReceiptText.isSeen(receipt) ? FlintColor.accent : FlintColor.fg4)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(ReceiptText.summary(receipt))
            .accessibilityIdentifier("thread.receiptCheck")
    }
}

/// The read receipt placeholder: a summary line and one line per tracked recipient. Details (devices, opens) come with the
/// receipts screens.
struct ReceiptRow: View {
    let receipt: ReceiptDetail
    let messageId: MessageRowID

    var body: some View {
        let people = ReceiptText.tracked(receipt)
        if !people.isEmpty {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s1) {
                HStack(spacing: FlintMetrics.Space.s2) {
                    Text(String(localized: "Read receipt", table: "Thread")).flintText(.label)
                    Text(ReceiptText.summary(receipt)).flintText(.body, color: ReceiptText.isSeen(receipt) ? FlintColor.accent : FlintColor.fg2)
                }
                if people.count > 1 {
                    ForEach(people, id: \.email) { person in
                        Text(ReceiptText.line(person)).flintText(.body, color: FlintColor.fg3)
                    }
                }
            }
            .padding(.top, FlintMetrics.Space.s3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) { FlintHairline() }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("thread.receipt.\(messageId)")
        }
    }
}

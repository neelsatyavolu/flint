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

// Binds the send job's small `TrackingProvider` port to the receipts client (HANDOFF 2B).

import FlintMail
import FlintModel
import FlintReceipts

struct ReceiptsTracking: TrackingProvider {
    let client: ReceiptsClient

    var isConfigured: Bool { get async { await client.isConfigured() } }

    func prepareTracked(accountId: AccountID, subject: String, messageId: String, recipients: [Address], selfAddresses: [String]) async -> SendTracking {
        let input = PrepareTrackedInput(accountId: accountId, subject: subject, messageId: messageId, recipients: recipients, selfAddresses: selfAddresses)
        do {
            let prepared = try await client.prepareTracked(input)
            return SendTracking(
                ref: prepared.ref,
                perRecipient: prepared.perRecipient.map { SendTrackingRecipient(address: $0.address, token: $0.token, pixelURL: $0.pixelURL) },
                untracked: prepared.untracked)
        } catch {
            // The contract: a receipts problem never stops the mail. Everyone goes out untracked.
            return SendTracking(ref: ReceiptPixel.newToken(), perRecipient: [], untracked: recipients)
        }
    }

    func recordUntracked(accountId: AccountID, subject: String, messageId: String, recipients: [Address], selfAddresses: [String], reason: String) async {
        let input = PrepareTrackedInput(accountId: accountId, subject: subject, messageId: messageId, recipients: recipients, selfAddresses: selfAddresses)
        _ = try? await client.recordUntracked(input, reason: reason)
    }

    func stopTracking(trackedId: Int) async {
        try? await client.stopTracking(trackedId)
    }

    func injectPixel(html: String, pixelURL: String) -> String {
        ReceiptPixel.injectPixel(into: html, pixelURL: pixelURL)
    }
}

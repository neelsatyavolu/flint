import FlintModel
import Foundation

/// What the card needs from the rest of the app, as closures so the model can be tested without a service.
struct InviteServices {
    var fetchAttachment: (_ id: Int) async throws -> Data
    /// Sends the reply from the account; false when it could not be queued (the app has already shown why).
    var sendReply: (_ reply: ImipReply, _ accountId: AccountID, _ from: String) async -> Bool
    var calendar: any CalendarWriting
    var ledger: InviteLedger
    var now: () -> EpochMs
    var zone: () -> String
}

extension InviteServices {
    @MainActor
    static func live(_ app: AppModel) -> InviteServices {
        InviteServices(
            fetchAttachment: { id in try Data(contentsOf: try await app.attachmentFile(id)) },
            sendReply: { reply, accountId, from in await InviteReplySender.send(reply, accountId: accountId, from: from, app: app) },
            calendar: app.isDemo ? DemoCalendarWriter() : EventKitCalendarWriter(),
            ledger: app.isDemo ? .demo : .live,
            now: { Int(Date().timeIntervalSince1970 * 1000) },
            zone: { TimeZone.current.identifier })
    }
}

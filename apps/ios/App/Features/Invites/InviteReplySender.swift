import FlintMail
import FlintModel
import Foundation

/// Sends an iMIP REPLY through the normal send path: a draft with the calendar part attached, no signature, no read receipt.
/// The draft is removed again if anything fails before it is queued.
@MainActor
enum InviteReplySender {
    /// RFC 6047 2.4: the mail builder turns an attachment of this type into a `text/calendar; method=REPLY` alternative part.
    static let contentType = CalendarPart.contentType(method: "REPLY")
    static let filename = "invite.ics"

    static func send(_ reply: ImipReply, accountId: AccountID, from: String, app: AppModel) async -> Bool {
        var draftId: Int?
        do {
            let file = try writeCalendarFile(reply.ics)
            defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
            let draft = try await app.createDraft(.new(accountId: accountId, to: [reply.to], subject: reply.subject, html: reply.html))
            draftId = draft.id
            let withFile = try await app.addAttachment(draftId: draft.id, file: file)
            let attachments = withFile.attachments.map { attachment -> DraftAttachment in
                var copy = attachment
                copy.contentType = contentType
                return copy
            }
            _ = try await app.updateDraft(id: draft.id, DraftPatch(
                from: from, html: reply.html, attachments: attachments, signatureId: .some(nil), track: false))
            return await app.sendDraft(id: draft.id) != nil
        } catch {
            if let draftId { await app.deleteDraft(id: draftId) }
            app.report(error)
            return false
        }
    }

    private static func writeCalendarFile(_ ics: String) throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("invite-reply-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent(filename)
        try Data(ics.utf8).write(to: file, options: .atomic)
        return file
    }
}

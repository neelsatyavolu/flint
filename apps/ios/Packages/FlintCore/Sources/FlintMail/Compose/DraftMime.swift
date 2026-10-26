// A draft as a MIME input: the body the user wrote (signature included) followed by the quoted original.
// Port of packages/core/src/service/compose-mime.ts.

import FlintModel
import Foundation

public enum DraftMime {
    /// What the recipient sees: the body the user wrote followed by the quoted original.
    public static func fullBodyHTML(html: String, quotedHtml: String) -> String {
        let quote = quotedHtml.isEmpty ? "" : "<br>\(quotedHtml)"
        return "<!doctype html><html><body>\(html)\(quote)</body></html>"
    }

    /// Everything `MimeInput` needs from a draft except the message id, tracking header and pixel.
    public static func input(draft: Draft, meta: DraftMeta, account: Account, plainTextOnly: Bool) -> MimeInput {
        let html = fullBodyHTML(html: draft.html, quotedHtml: draft.quotedHtml)
        return MimeInput(
            from: Address(name: account.name, address: draft.from), to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject,
            html: plainTextOnly ? "" : html, text: PlainText.fromHTML(html), attachments: draft.attachments, messageId: nil,
            inReplyTo: meta.inReplyTo, references: meta.references)
    }

    /// Throws a readable error when an attachment file went missing from the draft's folder.
    public static func assertAttachmentsExist(_ draft: Draft) throws {
        for attachment in draft.attachments where !FileManager.default.fileExists(atPath: attachment.path) {
            throw FlintError(.notFound, "The attachment \"\(attachment.filename)\" is no longer on this device. Remove it and add it again.")
        }
    }
}

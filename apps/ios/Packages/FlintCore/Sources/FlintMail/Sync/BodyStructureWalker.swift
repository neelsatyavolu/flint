// Splits a BODYSTRUCTURE tree into text bodies and attachments.
// Port of packages/core/src/mail/sync/bodystructure.ts.

import FlintModel
import Foundation

public struct TextPart: Hashable, Sendable {
    public var part: String
    /// "text/plain" or "text/html".
    public var type: String
    public var charset: String?
    public var encoding: String
}

public struct StructureInfo: Hashable, Sendable {
    public var text: [TextPart] = []
    public var attachments: [IngestAttachment] = []

    /// True when at least one attachment is not an inline image part.
    public var hasRealAttachments: Bool { attachments.contains { !$0.inline } }
}

public enum BodyStructureWalker {
    private static let extensions: [String: String] = ["jpeg": "jpg", "svg+xml": "svg", "plain": "txt", "calendar": "ics", "x-icon": "ico"]

    /// Text bodies (plain and html, in order) and attachments. Embedded messages are attachments and are not descended into.
    public static func walk(_ root: BodyPart?) -> StructureInfo {
        var info = StructureInfo()
        guard let root else { return info }
        visit(root, into: &info)
        return info
    }

    private static func visit(_ node: BodyPart, into info: inout StructureInfo) {
        let mediaType = node.mediaType
        if node.type.lowercased() == "multipart" || (!node.children.isEmpty && mediaType != "message/rfc822") {
            for child in node.children { visit(child, into: &info) }
            return
        }
        let leaf = node.number.isEmpty ? "1" : node.number
        let disposition = (node.disposition ?? "").lowercased()
        let filename = node.filename ?? node.parameters["name"] ?? ""
        if (mediaType == "text/plain" || mediaType == "text/html") && disposition != "attachment" && filename.isEmpty {
            info.text.append(TextPart(part: leaf, type: mediaType, charset: node.parameters["charset"], encoding: (node.encoding ?? "7bit").lowercased()))
            return
        }
        let contentId = stripBrackets(node.contentId)
        let inline = contentId != nil && disposition != "attachment"
        info.attachments.append(IngestAttachment(
            part: leaf, filename: filename.isEmpty ? fallbackName(node, part: leaf, inline: inline) : filename,
            contentType: mediaType, size: node.size, contentId: contentId, inline: inline))
    }

    private static func stripBrackets(_ id: String?) -> String? {
        guard let id else { return nil }
        let clean = MailHeaders.unbracketed(id).trimmingCharacters(in: .whitespaces)
        return clean.isEmpty ? nil : clean
    }

    private static func fallbackName(_ node: BodyPart, part: String, inline: Bool) -> String {
        let sub = node.subtype.lowercased().isEmpty ? "bin" : node.subtype.lowercased()
        let ext = extensions[sub] ?? sub.filter { $0.isLetter || $0.isNumber }
        return "\(inline ? "inline" : "attachment")-\(part).\(ext)"
    }
}

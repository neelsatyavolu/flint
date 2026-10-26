// Downloads and decodes the text and html bodies of one message. Port of packages/core/src/mail/sync/body.ts.
// The mailbox must already be selected on the transport.

import FlintModel
import Foundation

public enum BodyLoader {
    /// Pass the BODYSTRUCTURE when it is already known to save a round trip. Nil result: the message is gone.
    public static func load(_ transport: any MailTransport, uid: Int, structure: BodyPart? = nil) async throws -> MessageBody? {
        var tree = structure
        if tree == nil { tree = try await transport.fetchBodyStructure(uid: uid) }
        guard let tree else { return nil }
        let info = BodyStructureWalker.walk(tree)
        if info.text.isEmpty { return MessageBody(text: nil, html: nil) }
        var texts: [String] = []
        var htmls: [String] = []
        for part in info.text {
            let raw: Data
            do { raw = try await transport.fetchPart(uid: uid, part: part.part) }
            catch let error as FlintError where error.code == .notFound { continue }
            let decoded = TextDecoding.decode(raw, charset: part.charset)
            if part.type == "text/html" { htmls.append(decoded) } else { texts.append(decoded) }
        }
        return MessageBody(text: texts.isEmpty ? nil : texts.joined(separator: "\n\n"), html: htmls.isEmpty ? nil : htmls.joined(separator: "\n"))
    }
}

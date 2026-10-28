import Foundation
import Testing
@testable import FlintMail

@Suite("BodyPartTree")
struct MailBodyPartTreeTests {
    @Test func parsesContentTypes() {
        let r = BodyPartTree.parseContentType("Text/HTML; charset=\"UTF-8\"; format=flowed")
        #expect(r.type == "text" && r.subtype == "html" && r.parameters == ["charset": "UTF-8", "format": "flowed"])
        let bare = BodyPartTree.parseContentType("application/pdf")
        #expect(bare.type == "application" && bare.subtype == "pdf" && bare.parameters.isEmpty)
        #expect(BodyPartTree.parseContentType("").subtype == "octet-stream")
    }

    @Test func emptyAndSingleParts() {
        #expect(BodyPartTree.build([]) == nil)
        let single = BodyPartTree.build([PartDescriptor(section: "1", contentType: "text/plain; charset=utf-8", encoding: "QUOTED-PRINTABLE", size: 12)])
        #expect(single?.number == "1" && single?.mediaType == "text/plain" && single?.encoding == "quoted-printable" && single?.parameters["charset"] == "utf-8")
    }

    @Test func flatLeavesBecomeSiblingsUnderAMultipartRoot() {
        let tree = BodyPartTree.build([
            PartDescriptor(section: "1.1", contentType: "text/plain; charset=utf-8", encoding: "7bit"),
            PartDescriptor(section: "1.2", contentType: "text/html; charset=utf-8", encoding: "base64"),
            PartDescriptor(section: "2", contentType: "application/pdf", disposition: "attachment", encoding: "base64", filename: "a.pdf", size: 9),
        ])
        #expect(tree?.type == "multipart" && tree?.children.map(\.number) == ["1.1", "1.2", "2"])
        let info = BodyStructureWalker.walk(tree)
        #expect(info.text.map(\.part) == ["1.1", "1.2"] && info.attachments.map(\.filename) == ["a.pdf"])
    }

    @Test func embeddedMessagePartsStayInsideTheirMessage() {
        let tree = BodyPartTree.build([
            PartDescriptor(section: "1", contentType: "text/plain"),
            PartDescriptor(section: "2", contentType: "message/rfc822", disposition: "attachment", filename: "Fwd.eml", size: 500),
            PartDescriptor(section: "2.1", contentType: "text/plain"),
            PartDescriptor(section: "2.2", contentType: "image/png", disposition: "attachment", filename: "inner.png"),
            PartDescriptor(section: "3", contentType: "application/zip", disposition: "attachment", filename: "z.zip"),
        ])
        let info = BodyStructureWalker.walk(tree)
        #expect(info.text.map(\.part) == ["1"]) // the embedded text/plain is not a body
        #expect(info.attachments.map(\.filename) == ["Fwd.eml", "z.zip"])
        #expect(tree?.children.count == 3)
        #expect(tree?.children[1].children.map(\.number) == ["2.1", "2.2"])
    }

    @Test func nestedMessagesAreNestedInTheTree() {
        let tree = BodyPartTree.build([
            PartDescriptor(section: "1", contentType: "message/rfc822", filename: "a.eml"),
            PartDescriptor(section: "1.1", contentType: "message/rfc822", filename: "b.eml"),
            PartDescriptor(section: "1.1.1", contentType: "text/plain"),
        ])
        #expect(tree?.number == "1" && tree?.children.first?.number == "1.1" && tree?.children.first?.children.first?.number == "1.1.1")
        #expect(BodyStructureWalker.walk(tree).text.isEmpty)
    }

    @Test func aFilenameThatIsJustTheContentIdIsDropped() {
        // SwiftMail falls back to the Content-ID as the filename of an unnamed part.
        let tree = BodyPartTree.build([
            PartDescriptor(section: "1", contentType: "text/html; charset=utf-8", filename: "body@x", contentId: "<body@x>"),
            PartDescriptor(section: "2", contentType: "image/png", disposition: "inline", filename: "logo@x", contentId: "<logo@x>"),
            PartDescriptor(section: "3", contentType: "image/png", disposition: "inline", filename: "real.png", contentId: "<img3@x>"),
        ])
        let info = BodyStructureWalker.walk(tree)
        #expect(info.text.map(\.part) == ["1"])
        #expect(info.attachments.map(\.filename) == ["inline-2.png", "real.png"])
        #expect(info.attachments.allSatisfy(\.inline) && !info.hasRealAttachments)
    }
}

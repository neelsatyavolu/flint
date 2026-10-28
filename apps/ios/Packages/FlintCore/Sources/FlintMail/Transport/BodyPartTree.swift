// Rebuilds a BODYSTRUCTURE tree from the flat list of leaf parts a library reports.
//
// SwiftMail lists leaf parts only, each with its section number ("1", "2.1"), and for a message/rfc822 part it lists the
// part itself followed by the parts of the embedded message ("2", "2.1", "2.2"). The sync engine's walker needs the
// embedded message to stay one attachment, so descendants of a message/rfc822 part become its children (the walker does not
// descend into those). Other nesting (multipart/related, alternative) carries no meaning for the walker and is flattened.

import Foundation

/// One leaf part as a library describes it, before it becomes a `BodyPart`.
public struct PartDescriptor: Hashable, Sendable {
    public var section: String
    /// The Content-Type as the library renders it: `type/subtype` optionally followed by `; charset=...`.
    public var contentType: String
    public var disposition: String?
    public var encoding: String?
    public var filename: String?
    public var contentId: String?
    public var size: Int

    public init(section: String, contentType: String, disposition: String? = nil, encoding: String? = nil, filename: String? = nil, contentId: String? = nil, size: Int = 0) {
        self.section = section
        self.contentType = contentType
        self.disposition = disposition
        self.encoding = encoding
        self.filename = filename
        self.contentId = contentId
        self.size = size
    }
}

public enum BodyPartTree {
    /// `type`, `subtype` and parameters of a Content-Type value. Parameter names are lower-cased, quotes removed.
    public static func parseContentType(_ value: String) -> (type: String, subtype: String, parameters: [String: String]) {
        let pieces = value.split(separator: ";", omittingEmptySubsequences: true).map { $0.trimmingCharacters(in: .whitespaces) }
        let media = (pieces.first ?? "application/octet-stream").lowercased().split(separator: "/", maxSplits: 1).map(String.init)
        var parameters: [String: String] = [:]
        for piece in pieces.dropFirst() {
            guard let equals = piece.firstIndex(of: "=") else { continue }
            let name = piece[..<equals].trimmingCharacters(in: .whitespaces).lowercased()
            let raw = piece[piece.index(after: equals)...].trimmingCharacters(in: .whitespaces)
            parameters[name] = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        }
        return (media.first ?? "application", media.count > 1 ? media[1] : "octet-stream", parameters)
    }

    static func leaf(_ part: PartDescriptor) -> BodyPart {
        let (type, subtype, parameters) = parseContentType(part.contentType)
        var filename = part.filename.flatMap { $0.isEmpty ? nil : $0 }
        // SwiftMail names an unnamed part after its Content-ID. A body part must stay a body part, and an unnamed inline image
        // should get the desktop's "inline-N.ext" name, so a filename that is just the Content-ID is dropped.
        if let name = filename, let id = part.contentId.map(MailHeaders.unbracketed), name == id { filename = nil }
        return BodyPart(
            number: part.section, type: type, subtype: subtype, parameters: parameters, contentId: part.contentId, disposition: part.disposition?.lowercased(),
            filename: filename, encoding: part.encoding?.lowercased(), size: part.size)
    }

    private static func isDescendant(_ section: String, of ancestor: String) -> Bool {
        section.hasPrefix(ancestor + ".")
    }

    /// Nil for an empty list; the single part itself for one leaf; otherwise a multipart root holding the top-level parts.
    public static func build(_ parts: [PartDescriptor]) -> BodyPart? {
        guard !parts.isEmpty else { return nil }
        var roots: [BodyPart] = []
        // Open message/rfc822 parents, innermost last, as indexes into `roots` or nested children paths.
        var stack: [(section: String, path: [Int])] = []
        for part in parts {
            let node = leaf(part)
            while let top = stack.last, !isDescendant(part.section, of: top.section) { stack.removeLast() }
            let isMessage = node.mediaType == "message/rfc822"
            if let top = stack.last {
                insert(&roots, at: top.path, child: node)
                if isMessage { stack.append((part.section, top.path + [childCount(roots, at: top.path) - 1])) }
            } else {
                roots.append(node)
                if isMessage { stack.append((part.section, [roots.count - 1])) }
            }
        }
        if roots.count == 1 { return roots[0] }
        return BodyPart(number: "", type: "multipart", subtype: "mixed", children: roots)
    }

    private static func childCount(_ roots: [BodyPart], at path: [Int]) -> Int {
        var nodes = roots
        var current: BodyPart?
        for index in path {
            current = nodes[index]
            nodes = current?.children ?? []
        }
        return current?.children.count ?? 0
    }

    private static func insert(_ roots: inout [BodyPart], at path: [Int], child: BodyPart) {
        guard let first = path.first else { return }
        if path.count == 1 {
            roots[first].children.append(child)
        } else {
            insert(&roots[first].children, at: Array(path.dropFirst()), child: child)
        }
    }
}

// Maps LIST output to folder roles and Gmail labels to folder paths.
// Port of packages/core/src/mail/sync/folders.ts.

import FlintModel
import Foundation

public struct MailboxEntry: Hashable, Sendable {
    public var path: String
    public var name: String
    public var delimiter: String?
    public var role: MailboxRole?
    /// RFC 6154 attribute in IMAP spelling, for example `\Sent`.
    public var specialUse: String?
}

public enum FolderRoles {
    private static let specialUse: [String: MailboxRole] = [
        "inbox": .inbox, "sent": .sent, "drafts": .drafts, "trash": .trash, "junk": .spam,
        "archive": .archive, "all": .all, "flagged": .flagged, "important": .important,
    ]

    private static let nameRoles: [(NSRegularExpression, MailboxRole)] = [
        (rx("^(?:sent|sent items|sent mail|sent messages|gesendet|envoy[eé]s)$"), .sent),
        (rx("^(?:trash|deleted items|deleted messages|bin|corbeille|papierkorb)$"), .trash),
        (rx("^(?:junk|junk e-?mail|spam|bulk mail|junk mail)$"), .spam),
        (rx("^(?:drafts?|brouillons|entw[uü]rfe)$"), .drafts),
        (rx("^(?:archives?|all mail)$"), .archive),
    ]

    /// Gmail's system namespace names the label even when LIST carries no (or a localized-only) special-use flag.
    private static let gmailNamespaceRoles: [(NSRegularExpression, MailboxRole)] = [
        (rx(#"^\[(?:gmail|google mail)\]/(?:important|wichtig|importante|importants|importanti|belangrijk|wa[zż]ne)$"#), .important),
        (rx(#"^\[(?:gmail|google mail)\]/(?:starred|markiert mit stern|destacados|suivis|speciali|met ster|oznaczone gwiazdk[aą])$"#), .flagged),
    ]

    private static func rx(_ pattern: String) -> NSRegularExpression {
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// Special-use flags win; name heuristics fill gaps. One folder per role (INBOX always wins `.inbox`).
    public static func classify(_ list: [RemoteFolder]) -> [MailboxEntry] {
        let selectable = list.filter(\.isSelectable)
        var taken = Set<MailboxRole>()
        let first: [MailboxEntry] = selectable.map { folder in
            let use = folder.attributes.first { specialUse[$0.lowercased()] != nil }
            var role: MailboxRole? = use.flatMap { specialUse[$0.lowercased()] }
            if folder.path.uppercased() == "INBOX" { role = .inbox }
            if role == nil { role = gmailNamespaceRoles.first { matches($0.0, folder.path) }?.1 }
            if let role, role != .inbox { taken.insert(role) }
            return MailboxEntry(
                path: folder.path, name: folder.name, delimiter: folder.delimiter, role: role,
                specialUse: use.map { "\\" + $0.prefix(1).uppercased() + $0.dropFirst().lowercased() })
        }
        return first.map { entry in
            guard entry.role == nil, let hit = nameRoles.first(where: { matches($0.0, entry.name) }), !taken.contains(hit.1) else { return entry }
            taken.insert(hit.1)
            var named = entry
            named.role = hit.1
            return named
        }
    }

    private enum GmailSystem { case role(MailboxRole), skip }

    private static let gmailSystem: [String: GmailSystem] = [
        "\\inbox": .role(.inbox), "\\sent": .role(.sent), "\\draft": .role(.drafts), "\\drafts": .role(.drafts),
        "\\spam": .role(.spam), "\\trash": .role(.trash), "\\starred": .skip, "\\important": .skip,
    ]

    /// X-GM-LABELS to folder paths. System labels resolve through the account's role folders; user labels are their own path.
    public static func gmailLabelPaths(_ labels: [String], pathForRole: (MailboxRole) -> String?) -> [String] {
        var out: [String] = []
        for raw in labels {
            let label = raw.trimmingCharacters(in: .whitespaces)
            if label.isEmpty { continue }
            if label.hasPrefix("\\") {
                guard case .role(let role) = gmailSystem[label.lowercased()], let path = pathForRole(role) else { continue }
                if !out.contains(path) { out.append(path) }
                continue
            }
            if !out.contains(label) { out.append(label) }
        }
        return out
    }
}

// Thread-key resolution helpers (SPEC section 4). Pure functions ported from packages/core/src/threading/index.ts;
// shared fixture: threadkey.json. Regexes are ASCII-only where the TypeScript ones are.

import FlintModel
import Foundation

struct ThreadingInput: Hashable, Sendable {
    var gmThrid: String?
    var messageId: String?
    var inReplyTo: String?
    var references: [String]

    init(gmThrid: String? = nil, messageId: String? = nil, inReplyTo: String? = nil, references: [String] = []) {
        self.gmThrid = gmThrid
        self.messageId = messageId
        self.inReplyTo = inReplyTo
        self.references = references
    }
}

enum Threading {
    /// Messages in the same account within this window may join by subject.
    static let subjectJoinWindowMs = 14 * 24 * 60 * 60 * 1000

    private static let replyMarker = "^(re|fwd?|aw|sv|wg|vs|antw|tr|rv|r)\\s*(\\[[0-9]+\\])?\\s*:\\s*"
    private static let listTag = "^\\[[^\\]]{1,40}\\]\\s*"

    private static func collapse(_ s: String) -> String {
        s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    /// Subject without reply/forward markers and [list] tags, lowercased and collapsed.
    static func normalizeSubject(_ subject: String) -> String {
        var s = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        while true {
            let next = s
                .replacingOccurrences(of: replyMarker, with: "", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: listTag, with: "", options: .regularExpression)
            if next == s { break }
            s = next
        }
        return collapse(s)
    }

    /// Subject with only reply/forward markers removed ([tags] stay, so "[repo-a] Fix" and "[repo-b] Fix" differ).
    static func joinSubject(_ subject: String) -> String {
        var s = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        while true {
            let next = s.replacingOccurrences(of: replyMarker, with: "", options: [.regularExpression, .caseInsensitive])
            if next == s { break }
            s = next
        }
        return collapse(s)
    }

    /// SPEC section 4: Gmail uses X-GM-THRID, otherwise the first reference, else In-Reply-To, else the message's own id.
    static func threadKey(for i: ThreadingInput) -> String? {
        if let g = i.gmThrid, !g.isEmpty { return "gm:\(g)" }
        let root = cleanID(i.references.first) ?? cleanID(i.inReplyTo) ?? cleanID(i.messageId)
        return root.map { "mid:\($0)" }
    }

    /// True when the message points at another message, so subject matching must not apply.
    static func hasParentLink(_ i: ThreadingInput) -> Bool {
        cleanID(i.references.first) != nil || cleanID(i.inReplyTo) != nil
    }

    /// Every Message-ID this message links to (references, then In-Reply-To), cleaned and unique.
    static func linkedIDs(_ i: ThreadingInput) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for raw in i.references + [i.inReplyTo ?? ""] {
            if let id = cleanID(raw), seen.insert(id).inserted { out.append(id) }
        }
        return out
    }

    static func participantSet(_ lists: [Address]...) -> Set<String> {
        var out = Set<String>()
        for list in lists { for a in list where !a.address.isEmpty { out.insert(a.address.lowercased()) } }
        return out
    }

    static func sharesParticipant(_ a: Set<String>, _ b: Set<String>) -> Bool {
        !a.isDisjoint(with: b)
    }

    private static let genericSubjects: Set<String> = [
        "hi", "hello", "hey", "test", "testing", "question", "questions", "update", "updates", "meeting", "thanks", "thank you",
        "follow up", "following up", "reminder", "invoice", "receipt", "welcome", "(no subject)", "no subject", "quick question",
        "checking in", "hi there", "important", "fyi", "help", "request",
    ]

    /// True for subjects too common to prove two messages belong together.
    static func isGenericSubject(_ subject: String) -> Bool {
        let core = joinSubject(subject).replacingOccurrences(of: "[!.?\\s]+$", with: "", options: .regularExpression)
        return core.utf16.count < 5 || genericSubjects.contains(core)
    }

    /// True when headers mark list, bulk or machine-generated mail, which must never join a thread by subject alone.
    static func isAutomatedHeaders(_ headers: [String: String]) -> Bool {
        func present(_ key: String) -> Bool { !(headers[key] ?? "").isEmpty }
        if present("list-id") || present("list-unsubscribe") || present("x-github-reason") || present("feedback-id") { return true }
        let auto = (headers["auto-submitted"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !auto.isEmpty && auto != "no" { return true }
        let precedence = (headers["precedence"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ["bulk", "list", "junk"].contains(precedence)
    }
}

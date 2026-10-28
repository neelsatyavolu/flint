import Foundation
import FlintModel

public enum NeedsReplyReason: String, Codable, Hashable, Sendable {
    case question, request
}

/// Facts about a thread's newest message. Port of `AiThreadBrief` (`packages/core/src/ai/ports.ts`) minus the AI-only fields.
public struct ThreadBrief: Hashable, Sendable {
    public var threadId: ThreadID
    public var subject: String
    /// Date of the newest message.
    public var date: EpochMs
    /// Sender of the newest message.
    public var from: Address
    /// Start of the newest message's own text (quotes and signature removed).
    public var lastText: String
    public var unreadCount: Int
    public var messageCount: Int
    /// True when the user wrote the newest message.
    public var lastFromMe: Bool
    /// True when the newest message is flagged as answered.
    public var answered: Bool

    public init(
        threadId: ThreadID, subject: String, date: EpochMs, from: Address, lastText: String, unreadCount: Int = 0,
        messageCount: Int = 1, lastFromMe: Bool = false, answered: Bool = false
    ) {
        self.threadId = threadId
        self.subject = subject
        self.date = date
        self.from = from
        self.lastText = lastText
        self.unreadCount = unreadCount
        self.messageCount = messageCount
        self.lastFromMe = lastFromMe
        self.answered = answered
    }
}

public struct NeedsReplyItem: Hashable, Sendable {
    public var threadId: ThreadID
    public var subject: String
    public var from: Address
    public var date: EpochMs
    public var unreadCount: Int
    public var reason: NeedsReplyReason
}

/// "Needs reply": the newest message is from someone else, still unanswered, and asks a question or makes a request.
/// A local heuristic, no model call. Port of `packages/core/src/ai/needsReply.ts`.
public enum NeedsReply {
    private static let maxAgeMs = 14 * 24 * 60 * 60 * 1000
    private static let windowChars = 700

    private static let noReplySender = JSRegex(literal: #"^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|mailer-daemon|bounces?|alerts?|updates?|newsletter)([-_.+0-9].*)?\z"#, ignoreCase: true)

    private static let requestPatterns: [JSRegex] = ([
        #"\b(can|could|would|will) (you|u)\b"#,
        #"\bplease (let me know|confirm|send|reply|respond|review|advise|share|check|sign|approve|forward|call|get back)\b"#,
        #"\blet me know\b"#,
        #"\b(need|needs|want|wanted) (you|your)\b"#,
        #"\bwaiting (on|for) (you|your)\b"#,
        #"\b(get|getting) back to (me|us)\b"#,
        #"\brsvp\b"#,
        #"\bby (eod|end of (the )?day|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday)\b"#,
        #"\b(do|does) that work\b"#,
        #"\bwhat do you think\b"#,
    ] as [String]).map { JSRegex(literal: $0, ignoreCase: true) }

    private static let url = JSRegex(literal: #"https?://\S+"#, ignoreCase: true)
    private static let quotedLine = JSRegex(literal: #"^\s*>"#)
    private static let sentenceQuestion = JSRegex(literal: #"\?(\s|$|["')\]])"#)

    /// A question mark that ends a sentence, outside URLs and quoted lines.
    private static func hasQuestion(_ text: String) -> Bool {
        let withoutURLs = url.replacing(in: text, with: " ")
        return withoutURLs.components(separatedBy: "\n").contains { !quotedLine.test($0) && sentenceQuestion.test($0) }
    }

    /// Why this text wants an answer, or nil when it does not.
    public static func replyReason(_ text: String) -> NeedsReplyReason? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let window = String(decoding: Array(trimmed.utf16.prefix(windowChars)), as: UTF16.self)
        if window.isEmpty { return nil }
        if hasQuestion(window) { return .question }
        return requestPatterns.contains { $0.test(window) } ? .request : nil
    }

    /// Threads where someone else asked the user something and nobody has answered. Newest first.
    public static func detect(_ briefs: [ThreadBrief], now: EpochMs, max: Int = 8) -> [NeedsReplyItem] {
        var out: [NeedsReplyItem] = []
        for b in briefs {
            if b.lastFromMe || b.answered { continue }
            if now - b.date > maxAgeMs { continue }
            if noReplySender.test(b.from.address.components(separatedBy: "@").first ?? "") { continue }
            guard let reason = replyReason(b.lastText) else { continue }
            out.append(NeedsReplyItem(threadId: b.threadId, subject: b.subject, from: b.from, date: b.date, unreadCount: b.unreadCount, reason: reason))
        }
        return Array(out.sorted { $0.date > $1.date }.prefix(max))
    }
}

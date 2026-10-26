import FlintModel
import Foundation

/// Pure rules for the reader, ported from the desktop `Reader`, `MessageItem` and `state/compose`.
enum ThreadLogic {
    /// The message a reply should answer: the newest one that is not from the user, else the newest.
    static func replyTarget(_ messages: [MessageView]) -> MessageView? {
        messages.last { !$0.isFromMe } ?? messages.last
    }

    /// Which messages start expanded: the newest one and the newest unread one.
    static func initialExpanded(_ messages: [MessageView]) -> Set<MessageRowID> {
        var out = Set<MessageRowID>()
        if let last = messages.last { out.insert(last.id) }
        if let unread = messages.last(where: { !$0.seen }) { out.insert(unread.id) }
        return out
    }

    /// True when a reply would go to one person, so a plain Reply is offered next to Reply all.
    static func hasSingleRecipient(_ message: MessageView, selfAddresses: [String]) -> Bool {
        let selves = Set(selfAddresses.map { $0.lowercased() })
        let others = Set((message.from + message.to + message.cc).map { $0.address.lowercased() }.filter { !selves.contains($0) })
        return others.count <= 1
    }

    /// The reply, reply all or forward request for a message.
    static func draftInit(_ mode: ComposeMode, messageId: MessageRowID) -> DraftInit {
        switch mode {
        case .replyAll: .replyAll(messageId: messageId)
        case .forward: .forward(messageId: messageId)
        default: .reply(messageId: messageId)
        }
    }

    /// A shown message: the stream's copy, unless the person loaded its images and the stream has not caught up.
    static func merged(_ message: MessageView, override: MessageView?) -> MessageView {
        guard let override, message.remoteImages == .blocked, override.remoteImages == .allowed else { return message }
        return override
    }

    /// Where the Archive button becomes Move to Inbox.
    static func leavesInbox(_ selection: MailboxSelection) -> Bool {
        switch selection {
        case .archive, .trash, .spam, .folder: true
        default: false
        }
    }

    /// What Unsubscribe will do, in the order the service tries the methods.
    static func unsubscribeExplanation(_ info: UnsubscribeInfo) -> String {
        if info.oneClick, info.url != nil {
            return String(localized: "Flint will ask the sender's server to remove you. Nothing opens and no email is sent.", table: "Thread")
        }
        let to = info.mailto?.replacingOccurrences(of: "mailto:", with: "", options: [.caseInsensitive, .anchored]).split(separator: "?").first.map(String.init) ?? ""
        if !to.isEmpty { return String(localized: "Flint will send an unsubscribe email from your account to \(to).", table: "Thread") }
        return String(localized: "Flint will open the sender's unsubscribe page in your browser. You may need to confirm there.", table: "Thread")
    }
}

import FlintModel
import Foundation
import Observation

/// A reply whose send is waiting: inside its undo window, or scheduled for later.
struct QueuedReply: Equatable, Identifiable, Sendable {
    let id: Int
    let draftId: Int
    let to: [Address]
    let sendAt: EpochMs
    let createdAt: EpochMs

    /// Sends queued with the usual undo delay go out within a minute; anything later was scheduled on purpose.
    var isScheduled: Bool { sendAt - createdAt > 60_000 }

    init(_ send: ScheduledSend) {
        id = send.id
        draftId = send.draftId
        to = send.to
        sendAt = send.sendAt
        createdAt = send.createdAt
    }
}

/// What a tapped link needs from the person before it opens.
struct LinkPrompt: Identifiable, Equatable {
    let url: URL
    let shown: String
    var id: String { url.absoluteString }
}

/// A message's HTML split into what the sender wrote and the quoted history, with the HTML it was computed from.
struct HTMLSplit: Equatable, Sendable {
    let source: String
    let parts: QuotedText.HTMLParts
}

/// State of one open conversation: which messages are expanded, the Original / Adapted flips, adapter verdicts, images the
/// person loaded, sends waiting in their undo window, and the link being confirmed. The views read it; `ThreadRoot` feeds it.
@MainActor @Observable
final class ThreadModel {
    private(set) var detail: ThreadDetail?
    private(set) var expanded: Set<MessageRowID> = []
    private(set) var flipped: Set<MessageRowID> = []
    private(set) var verdicts: [MessageRowID: Bool] = [:]
    private(set) var overrides: [MessageRowID: MessageView] = [:]
    private(set) var queued: [QueuedReply] = []
    private(set) var splits: [MessageRowID: HTMLSplit] = [:]
    var linkPrompt: LinkPrompt?
    var safariURL: URL?

    @ObservationIgnored private var knownMessages: Set<MessageRowID> = []
    @ObservationIgnored private var draftThreads: [Int: ThreadID?] = [:]

    // MARK: Detail

    /// Takes a value from the thread stream. The first one opens the newest and the newest unread message; later ones keep
    /// the person's choices and open a message that just arrived.
    func apply(_ next: ThreadDetail) {
        let arrived = next.messages.filter { !knownMessages.contains($0.id) }
        if detail == nil {
            expanded = ThreadLogic.initialExpanded(next.messages)
        } else if let newest = arrived.last {
            expanded.insert(newest.id)
        }
        knownMessages.formUnion(next.messages.map(\.id))
        detail = next
    }

    func reset() {
        detail = nil
        expanded = []
        flipped = []
        verdicts = [:]
        overrides = [:]
        queued = []
        splits = [:]
        knownMessages = []
        draftThreads = [:]
        linkPrompt = nil
        safariURL = nil
    }

    func shown(_ message: MessageView) -> MessageView {
        ThreadLogic.merged(message, override: overrides[message.id])
    }

    var messages: [MessageView] { (detail?.messages ?? []).map(shown) }

    // MARK: Quoted text

    /// The split for the HTML the message has now, or nil until `prepareSplit` has run for it.
    func cachedSplit(for message: MessageView) -> QuotedText.HTMLParts? {
        guard let html = message.html, let hit = splits[message.id], hit.source == html else { return nil }
        return hit.parts
    }

    /// Splits the message's HTML off the main actor and keeps the result, so a re-render or a fold and unfold costs nothing.
    func prepareSplit(for message: MessageView) async {
        guard let html = message.html, cachedSplit(for: message) == nil else { return }
        let subject = message.subject
        let parts = await Task.detached(priority: .userInitiated) { QuotedText.splitHTML(html, subject: subject) }.value
        splits[message.id] = HTMLSplit(source: html, parts: parts)
    }

    // MARK: Per message

    func toggle(_ id: MessageRowID) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    func flip(_ id: MessageRowID) {
        if flipped.contains(id) { flipped.remove(id) } else { flipped.insert(id) }
    }

    func record(verdict adaptable: Bool, for id: MessageRowID) { verdicts[id] = adaptable }

    func setOverride(_ message: MessageView) { overrides[message.id] = message }

    func appearance(for message: MessageView, dark: Bool, matchTheme: Bool) -> MailAppearance {
        MailAppearance.resolve(dark: dark, matchTheme: matchTheme, flipped: flipped.contains(message.id), verdict: verdicts[message.id])
    }

    // MARK: Links

    /// Routes a link tap: opens it, asks first when the text and the address disagree, or returns the address of a `mailto:`.
    func route(href: String, text: String) -> String? {
        switch LinkPolicy.decide(href: href, text: text) {
        case .compose(let address): return address
        case .open(let url): showInBrowser(url)
        case .confirm(let url, let shown): linkPrompt = LinkPrompt(url: url, shown: shown)
        case .ignore: break
        }
        return nil
    }

    /// Opens Safari's in-app view. It raises for any scheme but http and https, so nothing else is ever handed to it.
    func showInBrowser(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return }
        safariURL = url
    }

    func confirmLink() {
        if let url = linkPrompt?.url { showInBrowser(url) }
        linkPrompt = nil
    }

    // MARK: Queued sends

    /// Pending sends whose draft belongs to this conversation. Runs until cancelled.
    func watchQueued(_ app: AppModel, threadId: ThreadID) async {
        do {
            for try await sends in app.scheduled() {
                var mine: [QueuedReply] = []
                for send in sends where send.status == .pending || send.status == .awaitingApproval {
                    if await thread(ofDraft: send.draftId, app) == threadId { mine.append(QueuedReply(send)) }
                }
                queued = mine
            }
        } catch {
            queued = []
        }
    }

    private func thread(ofDraft id: Int, _ app: AppModel) async -> ThreadID? {
        if let known = draftThreads[id] { return known }
        let found = try? await app.draft(id: id).threadId
        draftThreads[id] = .some(found)
        return found
    }
}

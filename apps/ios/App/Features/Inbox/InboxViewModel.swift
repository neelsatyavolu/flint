import FlintModel
import Foundation
import Observation

/// State behind the list screen: the rows of the selected mailbox, bundles, paging, the quick filter and the opened bundle.
/// Selection and actions are in `InboxViewModel+Actions.swift`.
@MainActor @Observable
final class InboxViewModel {
    enum Phase {
        case loading
        case ready
        case failed(any Error)
    }

    /// What decides a restart of the live query. A change of mailbox, filter or bundle also clears the list.
    struct Scope: Hashable {
        let mailbox: MailboxSelection
        let filter: InboxFilter
        let category: MailCategory?
    }

    static let pageSize = 50
    /// The service answers at most this many rows per query; more come by cursor.
    static let maxQueryLimit = 200

    let model: AppModel

    private(set) var items: [ThreadListItem] = []
    private(set) var bundles: [InboxBundle] = []
    private(set) var scheduled: [ScheduledSend] = []
    private(set) var phase: Phase = .loading
    private(set) var hasMore = false
    private(set) var olderOnServer = false
    private(set) var loadingOlder = false
    private(set) var loadFailed = false
    private(set) var limit = InboxViewModel.pageSize

    var filter: InboxFilter = .all {
        didSet { if filter != oldValue { selection = [] } }
    }
    var category: MailCategory? {
        didSet { if category != oldValue { selection = [] } }
    }
    var selection: Set<ThreadID> = []
    var picker: InboxPicker?
    var swipe: SwipeConfiguration

    @ObservationIgnored private var scope: Scope?
    @ObservationIgnored private var extra: [ThreadListItem] = []
    @ObservationIgnored private var tailCursor: String?
    @ObservationIgnored private var loadingMore = false
    @ObservationIgnored private(set) var query: ThreadQuery?

    init(model: AppModel) {
        self.model = model
        self.swipe = SwipeConfiguration.load(from: model.defaults)
    }

    var settings: Settings { model.settings ?? .default }
    var isSelecting: Bool { !selection.isEmpty || selectMode }
    var selectMode = false {
        didSet { if !selectMode { selection = [] } }
    }

    /// Bundles show only in the smart inbox, with no filter and no bundle open.
    var visibleBundles: [InboxBundle] { filter == .all && category == nil ? bundles : [] }

    var sections: [InboxSection] { InboxGrouping.sections(items) }

    /// The key a view uses for `.task(id:)`: it changes when the live query has to restart.
    func watchKey(for mailbox: MailboxSelection) -> String {
        "\(mailbox.identifier)|\(filter.rawValue)|\(category?.rawValue ?? "-")|\(limit)|\(settings.inbox.focused)"
    }

    // MARK: Watching

    /// Follows the list until the calling task is cancelled.
    func watch(_ mailbox: MailboxSelection) async {
        let next = Scope(mailbox: mailbox, filter: filter, category: category)
        if next != scope { reset(for: next) }
        if mailbox == .scheduled {
            await watchScheduled()
            return
        }
        guard let query = makeQuery(mailbox) else { return }
        self.query = query
        do {
            for try await page in model.threadPages(query) { apply(page) }
        } catch {
            if !Task.isCancelled { phase = .failed(error) }
        }
    }

    private func watchScheduled() async {
        do {
            for try await list in model.scheduled() {
                scheduled = list
                phase = .ready
            }
        } catch {
            if !Task.isCancelled { phase = .failed(error) }
        }
    }

    func makeQuery(_ mailbox: MailboxSelection) -> ThreadQuery? {
        guard var query = model.threadQuery(for: mailbox, limit: limit) else { return nil }
        if mailbox.isInbox { query.category = category }
        return filter.apply(to: query)
    }

    private func reset(for next: Scope) {
        scope = next
        items = []
        bundles = []
        scheduled = []
        extra = []
        tailCursor = nil
        hasMore = false
        olderOnServer = false
        loadFailed = false
        limit = Self.pageSize
        phase = .loading
    }

    private func apply(_ page: ThreadPage) {
        let known = Set(page.items.map(\.id))
        let tail = extra.filter { !known.contains($0.id) }
        items = page.items + tail
        bundles = page.bundles
        if tail.isEmpty {
            extra = []
            tailCursor = page.nextCursor
        }
        hasMore = tailCursor != nil || page.nextCursor != nil
        olderOnServer = page.olderOnServer
        phase = .ready
        let present = Set(items.map(\.id))
        if !selection.isSubset(of: present) { selection = selection.intersection(present) }
    }

    // MARK: Paging

    /// More rows from what the device already has. Grows the live query first; past the service limit it pages by cursor.
    func loadMore() async {
        guard hasMore, !loadingMore else { return }
        if limit < Self.maxQueryLimit {
            limit = min(limit + Self.pageSize, Self.maxQueryLimit)
            return
        }
        guard var next = query, let cursor = tailCursor else { return }
        loadingMore = true
        defer { loadingMore = false }
        next.cursor = cursor
        next.limit = Self.pageSize
        do {
            let page = try await model.listThreads(next)
            let known = Set(items.map(\.id))
            let fresh = page.items.filter { !known.contains($0.id) }
            extra += fresh
            items += fresh
            tailCursor = page.nextCursor
            hasMore = page.nextCursor != nil
            olderOnServer = page.olderOnServer
            loadFailed = false
        } catch {
            loadFailed = true
        }
    }

    /// Fetches the next batch of older mail from the servers; the live query then reports it.
    func loadOlder() async {
        guard let query, !loadingOlder else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let result = try await model.loadOlder(query)
            loadFailed = false
            if !result.hasMore { olderOnServer = false }
        } catch {
            loadFailed = true
            model.report(error)
        }
    }

    /// Pull to refresh.
    func refresh() async {
        await model.syncNow(accountId: model.mailbox.accountId)
    }

    // MARK: Display

    /// Account colors show in the unified lists when the setting is on and there is more than one account.
    func accountColor(for item: ThreadListItem) -> String? {
        guard settings.appearance.accountColors, model.accounts.count > 1, model.mailbox.accountId == nil else { return nil }
        return model.account(item.accountId)?.color
    }

    /// Title of the list, or of the opened bundle.
    var title: String {
        guard let category else { return model.title(for: model.mailbox) }
        return ThreadAction.title(of: category)
    }
}

/// The sheets a row action can raise.
enum InboxPicker: Identifiable {
    case snooze([ThreadID])
    case move([ThreadListItem])
    case swipeSettings

    var id: String {
        switch self {
        case .snooze: "snooze"
        case .move: "move"
        case .swipeSettings: "swipe"
        }
    }
}

extension MailboxSelection {
    var isInbox: Bool {
        if case .inbox = self { return true }
        return false
    }

    /// The account a list is limited to, or nil for a list across accounts.
    var accountId: AccountID? {
        switch self {
        case .inbox(let account): account
        case .folder(let account, _): account
        default: nil
        }
    }
}

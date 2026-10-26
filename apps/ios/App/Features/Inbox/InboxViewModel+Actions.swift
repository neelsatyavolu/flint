import FlintModel
import Foundation

/// A bulk action on a whole bundle, from its row.
struct BundleTriage: Identifiable, Equatable {
    enum Kind: Sendable { case read, archive }
    let category: MailCategory
    let kind: Kind
    let ids: [ThreadID]
    var id: String { "\(category.rawValue).\(kind)" }
}

extension InboxViewModel {
    /// Above this many conversations a bundle action asks first, as on the desktop.
    static let bundleConfirmOver = 50

    // MARK: Selection

    var selectedItems: [ThreadListItem] { items.filter { selection.contains($0.id) } }

    func toggleSelection(_ id: ThreadID) {
        var next = selection
        if next.contains(id) { next.remove(id) } else { next.insert(id) }
        selection = next
        selectMode = true
    }

    func selectAll() {
        selection = Set(items.filter { $0.draft == nil || $0.id > 0 }.map(\.id))
        selectMode = true
    }

    func endSelecting() {
        selectMode = false
        selection = []
    }

    // MARK: Row actions

    /// The ops a swipe side shows for a row, in order, skipping any that do not apply in this list.
    func ops(_ actions: [SwipeAction], for item: ThreadListItem) -> [InboxOp] {
        actions.compactMap { InboxOp.resolve($0, for: item, in: model.mailbox) }
    }

    /// Applies an op to rows. Snooze and move raise a picker first. Returns whether something ran.
    @discardableResult
    func perform(_ op: InboxOp, on rows: [ThreadListItem]) async -> Bool {
        let ids = rows.map(\.id).filter { $0 > 0 }
        let done: Bool
        switch op {
        case .archive: done = await model.archive(ids)
        case .moveToInbox: done = await model.moveToInbox(ids)
        case .trash: done = await model.trash(ids)
        case .pin(let pinned): done = await model.setPinned(ids, pinned: pinned)
        case .read(let read): done = await model.markRead(ids, read: read)
        case .unsnooze: done = await model.unsnooze(ids)
        case .deleteDraft: done = await deleteDrafts(rows)
        case .snooze:
            picker = .snooze(ids)
            return false
        case .move:
            picker = .move(rows.filter { $0.id > 0 })
            return false
        }
        if done { endSelectingIfNeeded(rows) }
        return done
    }

    private func endSelectingIfNeeded(_ rows: [ThreadListItem]) {
        let handled = Set(rows.map(\.id))
        if !selection.isDisjoint(with: handled) { endSelecting() }
    }

    /// Local drafts are deleted; server-only drafts go to the Trash like any conversation.
    private func deleteDrafts(_ rows: [ThreadListItem]) async -> Bool {
        let local = rows.compactMap(\.draft?.draftId)
        for id in local { await model.deleteDraft(id: id) }
        let threadIds = rows.filter { $0.draft?.draftId == nil }.map(\.id).filter { $0 > 0 }
        if !threadIds.isEmpty { return await model.trash(threadIds) }
        if !local.isEmpty { model.toasts.show(String(localized: "Draft deleted", table: "Inbox")) }
        return !local.isEmpty
    }

    func snooze(_ ids: [ThreadID], until date: Date) async {
        let done = await model.snooze(ids, until: EpochMs((date.timeIntervalSince1970 * 1000).rounded()))
        if done { endSelecting() }
    }

    func move(_ rows: [ThreadListItem], to folder: Folder) async {
        let done = await model.move(rows.map(\.id), to: folder)
        if done { endSelecting() }
    }

    // MARK: Opening

    /// Tap on a row: a draft reopens in the composer, anything else opens the conversation.
    func open(_ item: ThreadListItem) async {
        guard let draft = item.draft, model.mailbox == .drafts else {
            model.navigate(to: .thread(item.id))
            return
        }
        if let id = draft.draftId {
            model.navigate(to: .compose(.resume(draftId: id)))
        } else if let messageId = draft.messageId {
            do {
                let opened = try await model.openServerDraft(messageId: messageId)
                model.navigate(to: .compose(.resume(draftId: opened.id)))
            } catch {
                model.report(error)
            }
        }
    }

    /// Opens a bundle as its own list.
    func open(_ bundle: InboxBundle) { category = bundle.category }

    // MARK: Bundles

    /// Every conversation in a bundle (not only the rows loaded), unread ones only when marking read.
    func bundleThreadIds(_ category: MailCategory, unreadOnly: Bool) async throws -> [ThreadID] {
        var ids: [ThreadID] = []
        var cursor: String?
        repeat {
            let query = ThreadQuery(
                view: .inbox, accountId: model.mailbox.accountId, category: category, unreadOnly: unreadOnly, cursor: cursor, limit: Self.maxQueryLimit)
            let page = try await model.listThreads(query)
            ids += page.items.map(\.id)
            cursor = page.nextCursor
        } while cursor != nil
        return ids
    }

    /// "Mark all as read" or "Archive all" for a bundle. Returns a pending confirmation when the bundle is large.
    func triage(_ category: MailCategory, kind: BundleTriage.Kind) async -> BundleTriage? {
        do {
            let ids = try await bundleThreadIds(category, unreadOnly: kind == .read)
            guard !ids.isEmpty else { return nil }
            let triage = BundleTriage(category: category, kind: kind, ids: ids)
            if ids.count > Self.bundleConfirmOver { return triage }
            await run(triage)
            return nil
        } catch {
            model.toasts.show(String(localized: "Couldn't read that bundle. Try again.", table: "Inbox"), kind: .error)
            return nil
        }
    }

    func run(_ triage: BundleTriage) async {
        switch triage.kind {
        case .read: await model.markRead(triage.ids, read: true)
        case .archive: await model.archive(triage.ids)
        }
    }
}

extension InboxOp {
    /// The batch bar's buttons for a selection, in order.
    static func batch(_ rows: [ThreadListItem], in mailbox: MailboxSelection) -> [InboxOp] {
        if mailbox == .drafts { return [.deleteDraft] }
        var ops: [InboxOp] = []
        switch mailbox {
        case .archive, .trash, .spam: ops.append(.moveToInbox)
        default: ops.append(.archive)
        }
        if mailbox != .trash { ops.append(.trash) }
        ops.append(.pin(!rows.allSatisfy(\.pinned)))
        ops.append(.read(rows.contains { $0.unreadCount > 0 }))
        ops.append(mailbox == .snoozed ? .unsnooze : .snooze)
        ops.append(.move)
        return ops
    }
}

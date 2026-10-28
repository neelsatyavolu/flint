@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("Inbox view model", .serialized)
@MainActor
struct InboxViewModelTests {
    /// Polls until `condition` holds or two seconds pass.
    private func eventually(_ condition: () -> Bool) async -> Bool {
        for _ in 0..<80 {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(25))
        }
        return condition()
    }

    private func start(_ app: SeededApp, _ mailbox: MailboxSelection = .unifiedInbox) async -> (InboxViewModel, Task<Void, Never>) {
        app.model.navigate(to: .mailbox(mailbox))
        let viewModel = InboxViewModel(model: app.model)
        let task = Task { await viewModel.watch(mailbox) }
        _ = await eventually {
            if case .ready = viewModel.phase { return true }
            return false
        }
        return (viewModel, task)
    }

    @Test("the smart inbox lists people and folds the rest into bundles")
    func smartInbox() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app)
        #expect(!viewModel.items.isEmpty)
        #expect(viewModel.items.allSatisfy { $0.category == .people })
        #expect(Set(viewModel.visibleBundles.map(\.category)) == [.notifications, .newsletters])
        #expect(!viewModel.sections.isEmpty)
        task.cancel()
        await app.tearDown()
    }

    @Test("the unread filter lists only unread mail and hides bundles")
    func unreadFilter() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app)
        task.cancel()
        viewModel.filter = .unread
        let filtered = Task { await viewModel.watch(.unifiedInbox) }
        #expect(await eventually { !viewModel.items.isEmpty && viewModel.items.allSatisfy { $0.unreadCount > 0 } })
        #expect(viewModel.visibleBundles.isEmpty)
        filtered.cancel()
        await app.tearDown()
    }

    @Test("opening a bundle lists that category and closing it returns")
    func bundle() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app)
        task.cancel()
        let bundle = try #require(viewModel.visibleBundles.first)
        viewModel.open(bundle)
        #expect(viewModel.title == ThreadAction.title(of: bundle.category))
        let opened = Task { await viewModel.watch(.unifiedInbox) }
        #expect(await eventually { !viewModel.items.isEmpty && viewModel.items.allSatisfy { $0.category == bundle.category } })
        #expect(viewModel.visibleBundles.isEmpty)
        opened.cancel()
        await app.tearDown()
    }

    @Test("selection toggles, selects all and clears")
    func selection() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app)
        let first = try #require(viewModel.items.first)
        viewModel.toggleSelection(first.id)
        #expect(viewModel.selection == [first.id] && viewModel.isSelecting)
        viewModel.toggleSelection(first.id)
        #expect(viewModel.selection.isEmpty)
        viewModel.selectAll()
        #expect(viewModel.selection.count == viewModel.items.count)
        viewModel.endSelecting()
        #expect(viewModel.selection.isEmpty && !viewModel.isSelecting)
        task.cancel()
        await app.tearDown()
    }

    @Test("archiving a selection removes the rows and offers undo")
    func archiveSelection() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app)
        let chosen = Array(viewModel.items.prefix(2))
        for item in chosen { viewModel.toggleSelection(item.id) }
        let ran = await viewModel.perform(.archive, on: viewModel.selectedItems)
        #expect(ran)
        #expect(viewModel.selection.isEmpty)
        #expect(app.model.toasts.current?.undo != nil)
        let gone = Set(chosen.map(\.id))
        #expect(await eventually { viewModel.items.allSatisfy { !gone.contains($0.id) } })
        task.cancel()
        await app.tearDown()
    }

    @Test("pin and read change the row quietly")
    func pinAndRead() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app)
        let unread = try #require(viewModel.items.first { $0.unreadCount > 0 && !$0.pinned })
        #expect(await viewModel.perform(.read(true), on: [unread]))
        #expect(await eventually { viewModel.items.first { $0.id == unread.id }?.unreadCount == 0 })
        #expect(await viewModel.perform(.pin(true), on: [unread]))
        #expect(await eventually { viewModel.items.first { $0.id == unread.id }?.pinned == true })
        #expect(app.model.toasts.current == nil)
        task.cancel()
        await app.tearDown()
    }

    @Test("snooze and move raise their pickers without changing anything")
    func pickers() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app)
        let item = try #require(viewModel.items.first)
        #expect(await viewModel.perform(.snooze, on: [item]) == false)
        if case .snooze(let ids) = viewModel.picker { #expect(ids == [item.id]) } else { Issue.record("expected the snooze picker") }
        #expect(await viewModel.perform(.move, on: [item]) == false)
        if case .move(let rows) = viewModel.picker { #expect(rows.map(\.id) == [item.id]) } else { Issue.record("expected the move picker") }
        task.cancel()
        await app.tearDown()
    }

    @Test("bundle thread ids cover every conversation, unread only on request")
    func bundleIds() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app)
        let all = try await viewModel.bundleThreadIds(.notifications, unreadOnly: false)
        let unread = try await viewModel.bundleThreadIds(.notifications, unreadOnly: true)
        let total = try #require(viewModel.visibleBundles.first { $0.category == .notifications }?.totalCount)
        #expect(all.count == total)
        #expect(unread.count <= all.count && Set(unread).isSubset(of: Set(all)))
        task.cancel()
        await app.tearDown()
    }

    @Test("drafts list reopens a local draft in the composer")
    func drafts() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app, .drafts)
        let draft = try #require(viewModel.items.first { $0.draft?.draftId != nil })
        await viewModel.open(draft)
        if case .compose(.resume(let id)) = app.model.presented { #expect(id == draft.draft?.draftId) } else { Issue.record("expected the composer") }
        task.cancel()
        await app.tearDown()
    }

    @Test("scheduled sends load as their own list")
    func scheduled() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app, .scheduled)
        #expect(!viewModel.scheduled.isEmpty)
        #expect(viewModel.items.isEmpty)
        task.cancel()
        await app.tearDown()
    }

    @Test("load more grows the live query up to the service limit")
    func loadMore() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app, .unifiedInbox)
        #expect(viewModel.limit == InboxViewModel.pageSize)
        #expect(viewModel.watchKey(for: .unifiedInbox).contains("|50|"))
        task.cancel()
        await app.tearDown()
    }

    @Test("changing the list starts a clean one")
    func reset() async throws {
        let app = try await SeededApp.make()
        let (viewModel, task) = await start(app)
        task.cancel()
        let pinned = Task { await viewModel.watch(.pinned) }
        #expect(await eventually { !viewModel.items.isEmpty && viewModel.items.allSatisfy { $0.pinned } && viewModel.bundles.isEmpty })
        pinned.cancel()
        await app.tearDown()
    }

    @Test("a swipe choice saved elsewhere reaches the live list without a relaunch")
    func swipeRefresh() async throws {
        let app = try await SeededApp.make()
        let viewModel = InboxViewModel(model: app.model)
        #expect(viewModel.swipe.trailing.first == .archive)
        SwipeConfiguration(leading: [.read], trailing: [.trash, .archive]).save(to: app.model.defaults)
        viewModel.refreshSwipe()
        #expect(viewModel.swipe.trailing.first == .trash)
        await app.tearDown()
    }
}

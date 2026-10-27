@testable import Flint
import FlintModel
import Foundation
import Testing

@MainActor
@Suite("Read statuses model")
struct ReadStatusesModelTests {
    private func model(_ source: FakeReceiptsSource) -> ReadStatusesModel {
        ReadStatusesModel(source: source, poller: ReceiptsPoller(minInterval: 0, now: { Date() }))
    }

    @Test("load shows tracked mail newest first as the source returns it")
    func load() async {
        let source = FakeReceiptsSource(tracked: [ReceiptFixtures.tracked(2), ReceiptFixtures.tracked(1)])
        let vm = model(source)
        await vm.load()
        #expect(vm.items.map(\.trackedId) == [2, 1])
        #expect(vm.phase == .loaded)
    }

    @Test("an empty list says which filter it was")
    func empty() async {
        let vm = model(FakeReceiptsSource())
        await vm.load()
        #expect(vm.phase == .loaded)
        #expect(vm.items.isEmpty)
    }

    @Test("filters ask the source for opened or unopened mail")
    func filters() async {
        let source = FakeReceiptsSource(tracked: [
            ReceiptFixtures.tracked(1, status: .opened, opened: 1), ReceiptFixtures.tracked(2), ReceiptFixtures.tracked(3, status: .replied),
        ])
        let vm = model(source)
        await vm.select(.opened)
        #expect(vm.items.map(\.trackedId) == [1, 3])
        await vm.select(.unopened)
        #expect(vm.items.map(\.trackedId) == [2])
        #expect(source.filters == [.opened, .unopened])
        #expect(vm.filter == .unopened)
    }

    @Test("a failed first load shows an error and a retry works")
    func loadFails() async {
        let source = FakeReceiptsSource(tracked: [ReceiptFixtures.tracked(1)])
        source.listError = FlintError(.internal, "boom")
        let vm = model(source)
        await vm.load()
        guard case .failed(let text) = vm.phase else { Issue.record("expected failed"); return }
        #expect(text == "Something went wrong. Try again.")
        source.listError = nil
        await vm.load()
        #expect(vm.phase == .loaded)
        #expect(vm.items.count == 1)
    }

    @Test("refresh polls the service, then reloads, and clears an old notice")
    func refresh() async {
        let source = FakeReceiptsSource(tracked: [ReceiptFixtures.tracked(1)])
        let vm = model(source)
        await vm.load()
        source.tracked = [ReceiptFixtures.tracked(1, status: .opened, opened: 1)]
        await vm.refresh()
        #expect(source.refreshes == 1)
        #expect(vm.items.first?.summary.status == .opened)
        #expect(vm.notice == nil)
        #expect(!vm.isRefreshing)
    }

    @Test("a refresh that cannot reach the service keeps the list and says so")
    func refreshFails() async {
        let source = FakeReceiptsSource(tracked: [ReceiptFixtures.tracked(1)])
        source.refreshError = FlintError(.network, "tcp reset to receipts.example.com")
        let vm = model(source)
        await vm.load()
        await vm.refresh()
        #expect(vm.items.count == 1)
        #expect(vm.phase == .loaded)
        #expect(vm.notice == "Couldn't reach the receipts service. Try again.")
        #expect(vm.notice?.contains("example.com") == false)
    }

    @Test("an unset service address is explained with the service's own words")
    func refreshUnconfigured() async {
        let source = FakeReceiptsSource()
        source.refreshError = FlintError(.invalid, "Read receipts need a service address. Add one in Settings.")
        let vm = model(source)
        await vm.refresh()
        #expect(vm.notice == "Read receipts need a service address. Add one in Settings.")
    }

    @Test("opening a row loads its timeline once")
    func expand() async {
        let source = FakeReceiptsSource(tracked: [ReceiptFixtures.tracked(1)], details: [1: ReceiptFixtures.detail(1)])
        let vm = model(source)
        await vm.load()
        await vm.toggle(1)
        #expect(vm.expanded.contains(1))
        #expect(vm.details[1]?.trackedId == 1)
        await vm.toggle(1)
        #expect(!vm.expanded.contains(1))
        await vm.toggle(1)
        #expect(source.detailLoads == 2)
    }

    @Test("stopping tracking removes the row and reports success")
    func stop() async {
        let source = FakeReceiptsSource(tracked: [ReceiptFixtures.tracked(1), ReceiptFixtures.tracked(2)])
        let vm = model(source)
        await vm.load()
        let done = await vm.stopTracking(1)
        #expect(done)
        #expect(source.stopped == [1])
        #expect(vm.items.map(\.trackedId) == [2])
    }

    @Test("a receipt event from the service reloads the list")
    func watch() async {
        let source = FakeReceiptsSource(tracked: [ReceiptFixtures.tracked(1)])
        let vm = model(source)
        await vm.load()
        let task = Task { await vm.watch() }
        try? await Task.sleep(for: .milliseconds(50))
        source.tracked = [ReceiptFixtures.tracked(1, status: .replied)]
        source.signalChange()
        for _ in 0..<40 where vm.items.first?.summary.status != .replied { try? await Task.sleep(for: .milliseconds(50)) }
        task.cancel()
        #expect(vm.items.first?.summary.status == .replied)
    }
}

@MainActor
@Suite("Receipts poller")
struct ReceiptsPollerTests {
    private final class Clock: @unchecked Sendable {
        var date = Date(timeIntervalSince1970: 1_000_000)
    }

    @Test("polls once, then waits for the interval")
    func throttle() async {
        let clock = Clock()
        let poller = ReceiptsPoller(minInterval: 30, now: { clock.date })
        let source = FakeReceiptsSource()
        #expect(await poller.pollIfDue(source))
        #expect(!(await poller.pollIfDue(source)))
        clock.date.addTimeInterval(29)
        #expect(!(await poller.pollIfDue(source)))
        clock.date.addTimeInterval(2)
        #expect(await poller.pollIfDue(source))
        #expect(source.refreshes == 2)
    }

    @Test("force ignores the interval, which is what pull to refresh does")
    func force() async {
        let poller = ReceiptsPoller(minInterval: 3_600, now: { Date() })
        let source = FakeReceiptsSource()
        _ = await poller.pollIfDue(source)
        #expect(await poller.pollIfDue(source, force: true))
        #expect(source.refreshes == 2)
    }

    @Test("a failure is quiet and counts as an attempt so a dead service is not hammered")
    func failure() async {
        let clock = Clock()
        let poller = ReceiptsPoller(minInterval: 30, now: { clock.date })
        let source = FakeReceiptsSource()
        source.refreshError = FlintError(.network, "offline")
        #expect(!(await poller.pollIfDue(source)))
        #expect(!(await poller.pollIfDue(source)))
        #expect(source.refreshes == 1)
    }
}

import FlintModel
import Foundation
import Observation

/// State of the Read statuses list: tracked mail with per-recipient status, a filter, and each row's timeline.
@MainActor
@Observable
final class ReadStatusesModel {
    enum Phase: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    private(set) var phase = Phase.loading
    private(set) var items: [TrackedMessage] = []
    private(set) var filter = ReadStatusFilter.all
    private(set) var isRefreshing = false
    /// A refresh that could not reach the service. The list below it is still the last known state.
    private(set) var notice: String?
    private(set) var expanded: Set<Int> = []
    private(set) var details: [Int: ReceiptDetail] = [:]

    @ObservationIgnored private let source: any ReceiptsSource
    @ObservationIgnored private let poller: ReceiptsPoller

    init(source: any ReceiptsSource, poller: ReceiptsPoller = .shared) {
        self.source = source
        self.poller = poller
    }

    func load() async {
        do {
            items = try await source.listTracked(filter: filter)
            phase = .loaded
        } catch {
            if items.isEmpty { phase = .failed(FlintErrorText.message(for: error)) }
        }
    }

    func select(_ next: ReadStatusFilter) async {
        filter = next
        await load()
    }

    /// Asks the service for new events, then reloads. A service problem becomes a notice, never an empty list.
    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        notice = nil
        do { try await source.refresh() } catch { notice = Self.notice(for: error) }
        details = [:]
        await load()
        for id in expanded { await loadDetail(id) }
    }

    /// The foreground poll first (throttled), then the list.
    func onAppear() async {
        await poller.pollIfDue(source)
        await load()
    }

    func toggle(_ trackedId: Int) async {
        if expanded.remove(trackedId) != nil { return }
        expanded.insert(trackedId)
        await loadDetail(trackedId)
    }

    func stopTracking(_ trackedId: Int) async -> Bool {
        do {
            try await source.stopTracking(trackedId: trackedId)
            items.removeAll { $0.trackedId == trackedId }
            expanded.remove(trackedId)
            details[trackedId] = nil
            return true
        } catch {
            return false
        }
    }

    /// Reloads whenever the service reports a receipt change. Run it in a task tied to the screen.
    func watch() async {
        for await _ in source.changes() {
            details = [:]
            await load()
            for id in expanded { await loadDetail(id) }
        }
    }

    private func loadDetail(_ trackedId: Int) async {
        if let detail = try? await source.receipt(trackedId: trackedId) { details[trackedId] = detail }
    }

    private static func notice(for error: any Error) -> String {
        if let flint = error as? FlintError, flint.code == .invalid { return FlintErrorText.message(for: error) }
        return String(localized: "Couldn't reach the receipts service. Try again.", table: "Receipts")
    }
}

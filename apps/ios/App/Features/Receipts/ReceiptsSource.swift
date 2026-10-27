import FlintModel
import FlintService
import Foundation

/// Which tracked mail the Read statuses list shows.
enum ReadStatusFilter: String, CaseIterable, Sendable {
    case all, opened, unopened
}

/// What the receipts screens need from the service. The app uses `ServiceReceiptsSource`; tests use a fake.
protocol ReceiptsSource: Sendable {
    func listTracked(filter: ReadStatusFilter) async throws -> [TrackedMessage]
    func receipt(trackedId: Int) async throws -> ReceiptDetail
    /// Fetches new open events from the receipts service now.
    func refresh() async throws
    func stopTracking(trackedId: Int) async throws
    /// Yields whenever a receipt changes (an open or a reply arrived).
    func changes() -> AsyncStream<Void>
}

struct ServiceReceiptsSource: ReceiptsSource {
    let service: FlintService
    var limit = 100

    func listTracked(filter: ReadStatusFilter) async throws -> [TrackedMessage] {
        let unopened: Bool? = switch filter {
        case .all: nil
        case .opened: false
        case .unopened: true
        }
        return try await service.listTracked(limit: limit, unopened: unopened)
    }

    func receipt(trackedId: Int) async throws -> ReceiptDetail { try await service.receipt(trackedId: trackedId) }
    func refresh() async throws { try await service.refreshReceipts() }
    func stopTracking(trackedId: Int) async throws { try await service.stopTracking(trackedId: trackedId) }

    func changes() -> AsyncStream<Void> {
        let events = service.events()
        return AsyncStream { continuation in
            let task = Task {
                for await event in events {
                    if case .receipt = event { continuation.yield() }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

@testable import Flint
import FlintModel
import Foundation

/// A `ReceiptsSource` over arrays, with counters for what the screen asked. Not the network: see `FakeReceiptsServer` for that.
final class FakeReceiptsSource: ReceiptsSource, @unchecked Sendable {
    private let lock = NSLock()
    private var _tracked: [TrackedMessage]
    private var _details: [Int: ReceiptDetail]
    private var _refreshError: (any Error)?
    private var _listError: (any Error)?
    private var _filters: [ReadStatusFilter] = []
    private var _refreshes = 0
    private var _detailLoads = 0
    private var _stopped: [Int] = []
    private var continuation: AsyncStream<Void>.Continuation?

    init(tracked: [TrackedMessage] = [], details: [Int: ReceiptDetail] = [:]) {
        _tracked = tracked
        _details = details
    }

    var filters: [ReadStatusFilter] { locked { _filters } }
    var refreshes: Int { locked { _refreshes } }
    var detailLoads: Int { locked { _detailLoads } }
    var stopped: [Int] { locked { _stopped } }
    var refreshError: (any Error)? { get { locked { _refreshError } } set { locked { _refreshError = newValue } } }
    var listError: (any Error)? { get { locked { _listError } } set { locked { _listError = newValue } } }
    var tracked: [TrackedMessage] { get { locked { _tracked } } set { locked { _tracked = newValue } } }

    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    func listTracked(filter: ReadStatusFilter) async throws -> [TrackedMessage] {
        try locked {
            _filters.append(filter)
            if let _listError { throw _listError }
            switch filter {
            case .all: return _tracked
            case .opened: return _tracked.filter { $0.summary.opened > 0 || $0.summary.status == .replied }
            case .unopened: return _tracked.filter { $0.summary.opened == 0 && $0.summary.status != .replied }
            }
        }
    }

    func receipt(trackedId: Int) async throws -> ReceiptDetail {
        try locked {
            _detailLoads += 1
            guard let detail = _details[trackedId] else { throw FlintError(.notFound, "No such receipt.") }
            return detail
        }
    }

    func refresh() async throws {
        try locked {
            _refreshes += 1
            if let _refreshError { throw _refreshError }
        }
    }

    func stopTracking(trackedId: Int) async throws {
        locked {
            _stopped.append(trackedId)
            _tracked.removeAll { $0.trackedId == trackedId }
        }
    }

    func changes() -> AsyncStream<Void> {
        AsyncStream { continuation in
            locked { self.continuation = continuation }
        }
    }

    func signalChange() { locked { continuation }?.yield() }
}

enum ReceiptFixtures {
    static func tracked(_ id: Int, subject: String = "Subject", status: ReceiptStatus = .sent, opened: Int = 0, total: Int = 1) -> TrackedMessage {
        TrackedMessage(
            trackedId: id, accountId: "demo-work", threadId: id, subject: subject, sentAt: 1_000,
            summary: ReceiptSummary(opened: opened, total: total, status: status),
            recipients: [ReceiptRecipient(email: "p\(id)@x.example", status: status)])
    }

    static func detail(_ id: Int) -> ReceiptDetail {
        ReceiptDetail(trackedId: id, sentAt: 1_000, recipients: [ReceiptRecipient(email: "p\(id)@x.example", status: .sent)], events: [])
    }
}

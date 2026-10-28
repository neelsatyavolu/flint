import Foundation

/// Polls the receipts service when the app comes to the foreground or the user refreshes, at most once per `minInterval` so a
/// quick succession of screens does not hit the service each time. Failures are quiet: the next foreground tries again.
@MainActor
final class ReceiptsPoller {
    /// One poller for the app. The shell calls it on foreground and in pull to refresh (see HANDOFF).
    static let shared = ReceiptsPoller()

    private let minInterval: TimeInterval
    private let now: () -> Date
    private var lastAttempt: Date?

    init(minInterval: TimeInterval = 30, now: @escaping () -> Date = Date.init) {
        self.minInterval = minInterval
        self.now = now
    }

    /// Returns true when it polled and the service answered.
    @discardableResult
    func pollIfDue(_ source: any ReceiptsSource, force: Bool = false) async -> Bool {
        let current = now()
        if !force, let lastAttempt, current.timeIntervalSince(lastAttempt) < minInterval { return false }
        lastAttempt = current
        do {
            try await source.refresh()
            return true
        } catch {
            return false
        }
    }
}

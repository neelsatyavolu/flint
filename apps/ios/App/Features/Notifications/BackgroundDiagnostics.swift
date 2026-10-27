import Foundation

/// One background run, kept so the owner can measure how often iOS really wakes Flint (docs/ios/spikes/background-cadence.md).
/// It holds counts and an error code only: never a sender, a subject or any message text.
struct BackgroundRunRecord: Codable, Equatable, Identifiable, Sendable {
    enum Kind: String, Codable, Sendable { case refresh, processing, checkNow, notificationAction }
    enum Result: String, Codable, Sendable { case completed, failed, expired }

    var id: UUID
    var kind: Kind
    var startedAt: Date
    var durationMs: Int
    var result: Result
    /// Conversations with new mail seen during the run.
    var newMail: Int
    /// Local notifications the run posted.
    var alerts: Int
    var errorCode: String?
}

/// The newest-first list of runs and the numbers the Notifications page shows.
struct BackgroundDiagnostics: Codable, Equatable, Sendable {
    static let capacity = 30
    var runs: [BackgroundRunRecord] = []

    func adding(_ record: BackgroundRunRecord) -> BackgroundDiagnostics {
        BackgroundDiagnostics(runs: Array(([record] + runs).prefix(Self.capacity)))
    }

    var last: BackgroundRunRecord? { runs.first }

    /// Runs the system started (refresh and processing), the ones that measure cadence.
    var systemRuns: [BackgroundRunRecord] { runs.filter { $0.kind == .refresh || $0.kind == .processing } }
    var lastSystemRun: BackgroundRunRecord? { systemRuns.first }
    var totalNewMail: Int { runs.reduce(0) { $0 + $1.newMail } }

    /// Average minutes between the system runs on record, or nil with fewer than two.
    var averageGapMinutes: Int? {
        let times = systemRuns.map(\.startedAt).sorted()
        guard times.count >= 2, let first = times.first, let last = times.last else { return nil }
        return Int((last.timeIntervalSince(first) / Double(times.count - 1) / 60).rounded())
    }
}

/// Persists the diagnostics in `UserDefaults`.
struct BackgroundDiagnosticsStore: Sendable {
    static let key = "flint.backgroundDiagnostics"
    private let defaults: UserDefaultsBox

    init(defaults: UserDefaults = .standard) { self.defaults = UserDefaultsBox(defaults) }

    func load() -> BackgroundDiagnostics {
        guard let data = defaults.value.data(forKey: Self.key),
              let stored = try? JSONDecoder().decode(BackgroundDiagnostics.self, from: data) else { return BackgroundDiagnostics() }
        return stored
    }

    @discardableResult
    func append(_ record: BackgroundRunRecord) -> BackgroundDiagnostics {
        let next = load().adding(record)
        if let data = try? JSONEncoder().encode(next) { defaults.value.set(data, forKey: Self.key) }
        return next
    }

    func clear() { defaults.value.removeObject(forKey: Self.key) }
}

/// `UserDefaults` is thread safe but not marked `Sendable`.
struct UserDefaultsBox: @unchecked Sendable {
    let value: UserDefaults
    init(_ value: UserDefaults) { self.value = value }
}

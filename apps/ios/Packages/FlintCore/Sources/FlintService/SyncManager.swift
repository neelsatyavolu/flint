// One `AccountSession` per account: start, stop and restart as accounts change, plus the status map the sidebar reads.
// Port of packages/core/src/service/syncManager.ts.

import FlintMail
import FlintModel
import FlintStore
import Foundation
import Synchronization

final class SyncManager: Sendable {
    struct Dependencies: Sendable {
        var store: any Store
        var transport: MailTransportFactory
        var credentials: @Sendable (AccountID) async throws -> MailCredential
        var emit: @Sendable (FlintEvent) -> Void
        var configuration: SessionConfiguration
        var network: (any NetworkMonitoring)?
        var now: @Sendable () -> EpochMs
        /// False keeps sessions idle (they still serve actions). Tests that drive sync by hand turn it off.
        var runs: Bool = true
    }

    private struct State {
        var sessions: [AccountID: AccountSession] = [:]
        var started: Set<AccountID> = []
        var statuses: [AccountID: SyncStatus] = [:]
    }

    private let d: Dependencies
    private let state = Mutex(State())

    init(_ dependencies: Dependencies) { d = dependencies }

    // MARK: Lifecycle

    /// Starts the sync loop of every enabled account.
    func startAll() async {
        guard d.runs, let accounts = try? await d.store.listAccounts() else { return }
        for account in accounts where account.enabled { startOne(account.id) }
    }

    /// (Re)starts one account from scratch so changed credentials or servers take effect. A disabled account is stopped.
    func restart(_ id: AccountID) async {
        await stop(id)
        state.withLock { $0.statuses[id] = nil }
        if d.runs, let account = try? await d.store.account(id: id), account.enabled { startOne(id) }
    }

    func stop(_ id: AccountID) async {
        let session = state.withLock { s -> AccountSession? in
            s.started.remove(id)
            return s.sessions.removeValue(forKey: id)
        }
        await session?.stop()
    }

    /// Forgets an account entirely (after it was deleted).
    func forget(_ id: AccountID) async {
        await stop(id)
        state.withLock { $0.statuses[id] = nil }
    }

    func stopAll() async {
        let ids = state.withLock { Array($0.sessions.keys) }
        for id in ids { await stop(id) }
    }

    /// Restarts every account that stopped on a sign-in error, for example after the Google client id was corrected.
    func restartAuthErrors() async {
        let ids = state.withLock { s in s.statuses.filter { $0.value.state == .authError }.map(\.key) }
        for id in ids { await restart(id) }
    }

    // MARK: Access

    /// The account's session. For an account that is not running an idle one is created, so actions on its mail still
    /// reach the server.
    func session(for id: AccountID) -> AccountSession {
        state.withLock { s in
            if let existing = s.sessions[id] { return existing }
            let created = makeSession(id)
            s.sessions[id] = created
            return created
        }
    }

    func runningSessions() -> [AccountSession] {
        state.withLock { s in s.started.compactMap { s.sessions[$0] } }
    }

    func isRunning(_ id: AccountID) -> Bool { state.withLock { $0.started.contains(id) } }

    func status(_ id: AccountID) -> SyncStatus {
        state.withLock { $0.statuses[id] } ?? SyncStatus(accountId: id, state: .idle)
    }

    func statuses(for accounts: [Account]) -> [SyncStatus] { accounts.map { status($0.id) } }

    /// The sign-in for this account cannot be refreshed: show "Sign in again".
    func authFailed(_ id: AccountID, message: String) {
        let next = state.withLock { s -> SyncStatus? in
            guard s.statuses[id]?.state != .authError else { return nil }
            var status = s.statuses[id] ?? SyncStatus(accountId: id, state: .authError)
            status.state = .authError
            status.error = "Sign in again."
            s.statuses[id] = status
            return status
        }
        if let next { d.emit(.sync(next)) }
    }

    // MARK: Internals

    private func startOne(_ id: AccountID) {
        let session = state.withLock { s -> AccountSession? in
            guard s.started.insert(id).inserted else { return nil }
            if let existing = s.sessions[id] { return existing }
            let created = makeSession(id)
            s.sessions[id] = created
            return created
        }
        if let session { Task { await session.start() } }
    }

    private func record(_ status: SyncStatus) {
        state.withLock { $0.statuses[status.accountId] = status }
    }

    /// Called with the state lock held: it must not touch `state`.
    private func makeSession(_ id: AccountID) -> AccountSession {
        let credentials = d.credentials
        let emit = d.emit
        return AccountSession(
            accountId: id, store: d.store, transportFactory: d.transport, credentials: { try await credentials(id) },
            emit: { [weak self] event in
                if case .sync(let status) = event { self?.record(status) }
                emit(event)
            },
            configuration: d.configuration, network: d.network, now: d.now)
    }
}

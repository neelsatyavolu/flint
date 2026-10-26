import FlintModel
import SwiftUI

/// The sync status under the header: errors with retry, offline, syncing, or when mail last arrived.
struct SidebarSyncLine: View {
    let line: SyncLine
    let multipleAccounts: Bool
    let retry: (AccountID) -> Void
    let signIn: () -> Void

    var body: some View {
        switch line {
        case .problems(let problems):
            VStack(spacing: 0) {
                ForEach(problems) { problem in banner(problem) }
            }
        case .syncing(let done, let total):
            status(syncingText(done: done, total: total), identifier: "sidebar.sync.syncing", icon: .refresh)
        case .updated(let ms):
            status(String(localized: "Updated \(FlintTime.current.ago(ms))", table: "Sidebar"), identifier: "sidebar.sync.updated")
        case .quiet:
            EmptyView()
        }
    }

    private func banner(_ problem: SyncProblem) -> some View {
        let message = text(for: problem)
        switch problem.kind {
        case .signIn:
            return ErrorBanner(message: message, retryTitle: String(localized: "Sign in", table: "Sidebar"), identifier: "sidebar.syncError", retry: signIn)
        case .offline, .failed:
            return ErrorBanner(message: message, retryTitle: String(localized: "Try again", table: "Sidebar"), identifier: "sidebar.syncError") {
                retry(problem.accountId)
            }
        }
    }

    private func text(for problem: SyncProblem) -> String {
        let base: String
        switch problem.kind {
        case .offline: base = String(localized: "Offline. Flint retries every minute.", table: "Sidebar")
        case .signIn: base = String(localized: "Sign in again", table: "Sidebar")
        case .failed(let detail): base = detail ?? String(localized: "Sync failed", table: "Sidebar")
        }
        return multipleAccounts ? "\(problem.email): \(base)" : base
    }

    private func syncingText(done: Int?, total: Int?) -> String {
        guard let done, let total, total > 0 else { return String(localized: "Syncing", table: "Sidebar") }
        return String(localized: "Syncing \(done) of \(total)", table: "Sidebar")
    }

    private func status(_ text: String, identifier: String, icon: FlintIcon? = nil) -> some View {
        HStack(spacing: FlintMetrics.Space.s2) {
            if let icon { FlintIconView(icon: icon, size: 12, color: FlintColor.fg3) }
            Text(text).flintText(.data, color: FlintColor.fg3).lineLimit(1)
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.vertical, FlintMetrics.Space.s2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { FlintHairline() }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }
}

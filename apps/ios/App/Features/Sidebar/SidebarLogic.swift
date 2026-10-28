import FlintModel
import Foundation

/// One fixed row of the sidebar: where it goes, its icon and the number beside it (0 hides the number).
struct SidebarList: Equatable, Identifiable, Sendable {
    let selection: MailboxSelection
    let icon: FlintIcon
    let count: Int
    var id: String { selection.identifier }
}

/// The folders and labels of one account that have no row of their own.
struct SidebarFolderGroup: Equatable, Identifiable, Sendable {
    let account: Account
    let folders: [Folder]
    var id: AccountID { account.id }
}

/// One account whose sync needs attention.
struct SyncProblem: Equatable, Identifiable, Sendable {
    enum Kind: Equatable, Sendable {
        case offline
        case signIn
        case failed(String?)
    }

    let accountId: AccountID
    let email: String
    let kind: Kind
    var id: AccountID { accountId }
}

/// What the status line under the sidebar header says.
enum SyncLine: Equatable, Sendable {
    case problems([SyncProblem])
    case syncing(done: Int?, total: Int?)
    case updated(EpochMs)
    case quiet
}

/// Pure decisions behind the sidebar, so they can be tested without a view.
enum SidebarLogic {
    /// The lists above the folders, in the desktop's order.
    static func lists(counts: SidebarCounts) -> [SidebarList] {
        [
            SidebarList(selection: .unifiedInbox, icon: .inbox, count: counts.inbox),
            SidebarList(selection: .pinned, icon: .pin, count: counts.pinned),
            SidebarList(selection: .drafts, icon: .fileText, count: counts.drafts),
            SidebarList(selection: .sent, icon: .send, count: 0),
            SidebarList(selection: .scheduled, icon: .calendar, count: counts.scheduled),
            SidebarList(selection: .snoozed, icon: .clock, count: counts.snoozed),
            SidebarList(selection: .trash, icon: .trash, count: 0),
            SidebarList(selection: .spam, icon: .shield, count: counts.spam),
        ]
    }

    static let maxRecents = 5

    /// The recent searches the sidebar lists: no blanks, no repeats, newest first, at most `maxRecents`.
    static func recents(_ searches: [String]) -> [String] {
        var seen = Set<String>()
        let clean = searches.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
        return Array(clean.prefix(maxRecents))
    }

    private static let ownRows: Set<MailboxRole> = [.inbox, .sent, .drafts, .trash, .spam, .archive]

    /// User folders and labels, and roles without their own row (all mail, flagged, important). Roles first, then by name.
    static func moreFolders(_ folders: [Folder]) -> [Folder] {
        folders
            .filter { folder in folder.role.map { !ownRows.contains($0) } ?? true }
            .sorted { a, b in
                if (a.role != nil) != (b.role != nil) { return a.role != nil }
                return a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
    }

    static func folderGroups(_ data: SidebarData?) -> [SidebarFolderGroup] {
        (data?.accounts ?? []).compactMap { entry in
            let folders = moreFolders(entry.folders)
            return folders.isEmpty ? nil : SidebarFolderGroup(account: entry.account, folders: folders)
        }
    }

    /// Problems first, then "syncing", then when mail last arrived. Statuses for accounts that are gone are ignored.
    static func syncLine(accounts: [Account], statuses: [SyncStatus]) -> SyncLine {
        let known = Dictionary(accounts.map { ($0.id, $0.email) }, uniquingKeysWith: { first, _ in first })
        let relevant = statuses.filter { known[$0.accountId] != nil }
        let problems = relevant.compactMap { status -> SyncProblem? in
            guard let email = known[status.accountId], let kind = problemKind(status) else { return nil }
            return SyncProblem(accountId: status.accountId, email: email, kind: kind)
        }
        if !problems.isEmpty { return .problems(problems) }
        let syncing = relevant.filter { $0.state == .syncing }
        if !syncing.isEmpty {
            let progress = syncing.compactMap(\.progress)
            guard !progress.isEmpty else { return .syncing(done: nil, total: nil) }
            return .syncing(done: progress.map(\.done).reduce(0, +), total: progress.map(\.total).reduce(0, +))
        }
        if let last = relevant.compactMap(\.lastSyncAt).max() { return .updated(last) }
        return .quiet
    }

    private static func problemKind(_ status: SyncStatus) -> SyncProblem.Kind? {
        switch status.state {
        case .idle, .syncing: nil
        case .offline: .offline
        case .authError: .signIn
        case .error: .failed(status.error?.isEmpty == false ? status.error : nil)
        }
    }

    /// Statuses from the live stream win over the copy inside the sidebar snapshot.
    static func statuses(live: [SyncStatus], data: SidebarData?) -> [SyncStatus] {
        let liveIds = Set(live.map(\.accountId))
        return live + (data?.accounts ?? []).map(\.sync).filter { !liveIds.contains($0.accountId) }
    }
}

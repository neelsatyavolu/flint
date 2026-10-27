import FlintModel
import Foundation

/// Which list the middle column (or the phone's first screen) shows.
enum MailboxSelection: Hashable, Sendable {
    /// The unified inbox (nil) or one account's inbox.
    case inbox(AccountID?)
    case pinned
    case drafts
    /// Sends waiting for their undo window or a chosen time. This is a list of `ScheduledSend`, not threads.
    case scheduled
    case snoozed
    case sent
    case archive
    case trash
    case spam
    /// One folder or label of one account.
    case folder(AccountID, FolderID)

    static let unifiedInbox = MailboxSelection.inbox(nil)

    /// The thread query behind this list; nil for `.scheduled`. `focused` is the Smart inbox setting.
    func threadQuery(focused: Bool = true, limit: Int = 50) -> ThreadQuery? {
        switch self {
        case .inbox(let account): ThreadQuery(view: .inbox, accountId: account, focused: focused, limit: limit)
        case .pinned: ThreadQuery(view: .pinned, limit: limit)
        case .drafts: ThreadQuery(view: .drafts, limit: limit)
        case .scheduled: nil
        case .snoozed: ThreadQuery(view: .snoozed, limit: limit)
        case .sent: ThreadQuery(view: .sent, limit: limit)
        case .archive: ThreadQuery(view: .archive, limit: limit)
        case .trash: ThreadQuery(view: .trash, limit: limit)
        case .spam: ThreadQuery(view: .spam, limit: limit)
        case .folder(let account, let folder): ThreadQuery(view: .folder, accountId: account, folderId: folder, limit: limit)
        }
    }

    /// Stable text for accessibility identifiers and logs, for example `inbox`, `inbox.demo-work`, `folder.demo-work.7`.
    var identifier: String {
        switch self {
        case .inbox(let account): account.map { "inbox.\($0)" } ?? "inbox"
        case .pinned: "pinned"
        case .drafts: "drafts"
        case .scheduled: "scheduled"
        case .snoozed: "snoozed"
        case .sent: "sent"
        case .archive: "archive"
        case .trash: "trash"
        case .spam: "spam"
        case .folder(let account, let folder): "folder.\(account).\(folder)"
        }
    }
}

/// What a compose sheet opens.
enum ComposeRequest: Hashable, Sendable {
    /// Create a draft from this start (new, reply, reply all, forward) and open it.
    case start(DraftInit)
    /// Open a draft that already exists (from Drafts, or restored after an undo send).
    case resume(draftId: Int)
}

enum SettingsSection: String, Hashable, Sendable, CaseIterable {
    case root, accounts, appearance, inbox, compose, signatures, rules, notifications, privacy, receipts, devices, about
}

/// Where the app can go. Every navigation in the shell, deep links and the features' own buttons use `AppModel.navigate(to:)`.
enum Route: Hashable, Sendable {
    /// Show a list. On iPhone this also closes the sidebar sheet and any open thread.
    case mailbox(MailboxSelection)
    /// Open a conversation in the thread column (iPad) or push it (iPhone).
    case thread(ThreadID)
    case compose(ComposeRequest)
    /// Open search, optionally with a query already typed.
    case search(String?)
    case settings(SettingsSection)
    /// The add-account flow.
    case onboarding
    /// The sidebar as a sheet. Only meaningful on iPhone; on iPad the sidebar is a column.
    case sidebar
    /// Close the presented sheet, or go back from the open thread.
    case dismiss
}

/// A sheet over the shell. One at a time.
enum Presented: Hashable, Identifiable, Sendable {
    case sidebar
    case compose(ComposeRequest)
    case search(String?)
    case settings(SettingsSection)
    case onboarding

    var id: String {
        switch self {
        case .sidebar: "sidebar"
        case .compose(let request): "compose.\(request.hashValue)"
        case .search: "search"
        case .settings: "settings"
        case .onboarding: "onboarding"
        }
    }
}

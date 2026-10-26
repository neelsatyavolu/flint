import FlintModel
import Foundation

extension AppModel {
    /// Goes to a place in the app. The shell, deep links and the features' buttons all use this.
    func navigate(to route: Route) {
        switch route {
        case .mailbox(let selection):
            mailbox = selection
            openThread = nil
            if presented == .sidebar { presented = nil }
        case .thread(let id):
            presented = nil
            openThread = id
        case .compose(let request):
            presented = .compose(request)
        case .search(let query):
            presented = .search(query)
        case .settings(let section):
            presented = .settings(section)
        case .onboarding:
            presented = .onboarding
        case .sidebar:
            presented = .sidebar
        case .dismiss:
            if presented != nil { presented = nil } else { openThread = nil }
        }
    }

    /// Routes a URL the app was opened with. Sign-in redirects normally reach the web sign-in session directly; they are kept
    /// here only for a cold launch from the URL.
    func handle(url: URL) { handle(link: DeepLink.parse(url)) }

    func handle(link: DeepLink) {
        switch link {
        case .pair:
            setPendingLink(link)
            navigate(to: .onboarding)
        case .oauthCallback:
            setPendingLink(link)
        case .unknown:
            break
        }
    }

    /// The menu button: on iPad shows or hides the sidebar column, on iPhone opens the sidebar sheet.
    func toggleSidebar(columns: Bool) {
        if columns {
            columnVisibility = columnVisibility == .all ? .doubleColumn : .all
        } else {
            navigate(to: .sidebar)
        }
    }

    /// Title of a list for headers and the sidebar, for example "Inbox", "All inboxes", "Work", "Newsletters".
    func title(for selection: MailboxSelection) -> String {
        switch selection {
        case .inbox(let id):
            guard let id else { return String(localized: "Inbox", table: "Shell") }
            return accountName(id)
        case .pinned: return String(localized: "Pins", table: "Shell")
        case .drafts: return String(localized: "Drafts", table: "Shell")
        case .scheduled: return String(localized: "Scheduled", table: "Shell")
        case .snoozed: return String(localized: "Snoozed", table: "Shell")
        case .sent: return String(localized: "Sent", table: "Shell")
        case .archive: return String(localized: "Archive", table: "Shell")
        case .trash: return String(localized: "Trash", table: "Shell")
        case .spam: return String(localized: "Spam", table: "Shell")
        case .folder(let account, let folder):
            let name = sidebar?.accounts.first { $0.id == account }?.folders.first { $0.id == folder }?.name
            return name ?? accountName(account)
        }
    }

    /// The display name of an account: its name, else its address.
    func accountName(_ id: AccountID) -> String {
        guard let account = accounts.first(where: { $0.id == id }) else { return "" }
        return account.name.isEmpty ? account.email : account.name
    }

    func account(_ id: AccountID) -> Account? { accounts.first { $0.id == id } }

    /// The thread query for the selected list, using the Smart inbox setting.
    func threadQuery(for selection: MailboxSelection, limit: Int = 50) -> ThreadQuery? {
        selection.threadQuery(focused: settings?.inbox.focused ?? true, limit: limit)
    }
}

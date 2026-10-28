import FlintModel
import Foundation

extension AppModel {
    /// Goes to a place in the app. The shell, deep links and the features' buttons all use this.
    func navigate(to route: Route) {
        switch route {
        case .mailbox(let selection):
            mailbox = selection
            searchReturn = nil
            openThread = nil
            if presented == .sidebar { presented = nil }
        case .thread(let id):
            searchReturn = nil
            present(nil)
            openThread = id
        case .compose(let request):
            parkedCompose = nil
            presented = .compose(request)
        case .search(let query):
            let start = query ?? searchReturn
            searchReturn = nil
            present(.search(start))
        case .settings(let section):
            present(.settings(section))
        case .receipts:
            present(.receipts)
        case .onboarding:
            present(.onboarding)
        case .sidebar:
            present(.sidebar)
        case .dismiss:
            if presented != nil { presented = nil } else { openThread = nil }
        }
    }

    /// Opens a search result. Back (or closing the thread) returns to the same search.
    func openFromSearch(_ id: ThreadID, query: String) {
        navigate(to: .thread(id))
        searchReturn = query
    }

    /// Replaces the sheet. On iPad a composer that is showing as the panel is parked instead of closed.
    private func present(_ next: Presented?) {
        if isWide, case .compose(let request)? = presented { parkedCompose = request }
        presented = next
    }

    func returnToSearchIfNeeded() {
        guard let query = searchReturn, presented == nil else { return }
        searchReturn = nil
        presented = .search(query)
    }

    /// What the iPad composer panel shows: the composer being presented, or the one parked behind another sheet.
    var composerPanelRequest: ComposeRequest? {
        guard isWide else { return nil }
        if case .compose(let request)? = presented { return request }
        return parkedCompose
    }

    /// Closes the composer wherever it is (sheet or panel). The composer calls it when it is done.
    func closeComposer() {
        if case .compose? = presented { presented = nil }
        parkedCompose = nil
    }

    /// The root view reports whether the window is wide. A panel composer becomes a sheet again when the window turns compact.
    func setWide(_ wide: Bool) {
        isWide = wide
        guard !wide, let request = parkedCompose else { return }
        parkedCompose = nil
        if presented == nil { presented = .compose(request) }
    }

    /// Letter shortcuts (E, J, K, arrows) are off while text could be typed or a choice is being made: a sheet is up (including
    /// the thread's own Snooze and Move) or the composer panel is open.
    var singleKeyShortcutsActive: Bool { presented == nil && composerPanelRequest == nil && !threadSheetUp }

    /// Every shortcut is off until the app is ready and while the lock cover hides the mail.
    var shortcutsReady: Bool { phase == .ready && !isCovered }

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

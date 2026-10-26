import FlintModel
import SwiftUI

/// The mailbox list: unified inbox with an account under it, pins, drafts, sent, scheduled, snoozed, trash, spam, then archive
/// and each account's folders and labels, a sync status line and Settings. A sheet on iPhone, the first column on iPad.
struct SidebarRoot: View {
    @Environment(AppModel.self) private var model
    @State private var accountsExpanded = true

    private var accounts: [Account] { model.accounts }
    private var multiple: Bool { accounts.count > 1 }

    var body: some View {
        VStack(spacing: 0) {
            FlintBar(
                title: String(localized: "Flint", table: "Sidebar"), plane: FlintColor.plane0,
                leading: { closeButton },
                trailing: { EmptyView() })
            SidebarSyncLine(line: syncLine, multipleAccounts: multiple, retry: retry, signIn: { model.navigate(to: .settings(.accounts)) })
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(SidebarLogic.lists(counts: model.sidebar?.counts ?? SidebarCounts())) { list in
                        listRow(list)
                        if list.selection == .unifiedInbox, multiple, accountsExpanded { accountRows }
                    }
                    foldersSection
                }
                .padding(.bottom, FlintMetrics.Space.s4)
            }
            footer
        }
        .background(FlintColor.plane0)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sidebar.root")
    }

    // MARK: Header and footer

    @ViewBuilder private var closeButton: some View {
        if model.presented == .sidebar {
            FlintIconButton(icon: .close, label: String(localized: "Close", table: "Sidebar"), identifier: "sidebar.close") {
                model.navigate(to: .dismiss)
            }
        }
    }

    private var footer: some View {
        SidebarRowView(leading: .icon(.settings), title: String(localized: "Settings", table: "Sidebar"), identifier: "sidebar.settings") {
            model.navigate(to: .settings(.root))
        }
        .overlay(alignment: .top) { FlintHairline() }
        .background(FlintColor.plane0)
    }

    // MARK: Sync

    private var syncLine: SyncLine {
        SidebarLogic.syncLine(accounts: accounts, statuses: SidebarLogic.statuses(live: model.syncStatuses, data: model.sidebar))
    }

    private func retry(_ id: AccountID) {
        Task { await model.syncNow(accountId: id) }
    }

    // MARK: Lists

    @ViewBuilder private func listRow(_ list: SidebarList) -> some View {
        if list.selection == .unifiedInbox, multiple {
            HStack(spacing: 0) {
                row(list)
                disclosure.background(model.mailbox == list.selection ? FlintColor.accentSoft : .clear)
            }
        } else {
            row(list)
        }
    }

    private func row(_ list: SidebarList) -> some View {
        SidebarRowView(
            leading: .icon(list.icon), title: model.title(for: list.selection), count: list.count,
            isSelected: model.mailbox == list.selection, identifier: "sidebar.row.\(list.selection.identifier)"
        ) { model.navigate(to: .mailbox(list.selection)) }
    }

    private var disclosure: some View {
        FlintIconButton(
            icon: accountsExpanded ? .chevronDown : .chevronRight,
            label: accountsExpanded ? String(localized: "Hide accounts", table: "Sidebar") : String(localized: "Show accounts", table: "Sidebar"),
            identifier: "sidebar.toggleAccounts"
        ) { accountsExpanded.toggle() }
    }

    @ViewBuilder private var accountRows: some View {
        ForEach(model.sidebar?.accounts ?? []) { entry in
            let selection = MailboxSelection.inbox(entry.id)
            SidebarRowView(
                leading: .avatar(address: entry.account.email, name: entry.account.name), title: entry.account.email,
                count: entry.inboxUnread, isSelected: model.mailbox == selection, depth: 1,
                identifier: "sidebar.row.\(selection.identifier)"
            ) { model.navigate(to: .mailbox(selection)) }
        }
    }

    // MARK: Folders and labels

    @ViewBuilder private var foldersSection: some View {
        SidebarSectionLabel(text: String(localized: "Folders", table: "Sidebar"), identifier: "sidebar.section.folders")
        SidebarRowView(
            leading: .icon(.archive), title: model.title(for: .archive), isSelected: model.mailbox == .archive,
            identifier: "sidebar.row.archive"
        ) { model.navigate(to: .mailbox(.archive)) }
        ForEach(SidebarLogic.folderGroups(model.sidebar)) { group in
            if multiple {
                Text(group.account.email)
                    .flintText(.data, color: FlintColor.fg3)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .padding(.horizontal, FlintMetrics.Space.s4)
                    .padding(.top, FlintMetrics.Space.s3)
                    .padding(.bottom, FlintMetrics.Space.s1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
            }
            ForEach(group.folders) { folder in folderRow(folder, group: group) }
        }
    }

    private func folderRow(_ folder: Folder, group: SidebarFolderGroup) -> some View {
        let selection = MailboxSelection.folder(folder.accountId, folder.id)
        return SidebarRowView(
            leading: .icon(group.account.provider == .gmail ? .tag : .folder), title: folder.name, count: folder.unread,
            isSelected: model.mailbox == selection, identifier: "sidebar.row.\(selection.identifier)"
        ) { model.navigate(to: .mailbox(selection)) }
    }
}

import FlintModel
import SwiftUI

/// PLACEHOLDER (track 3B replaces this file). Shows the sidebar data the shell already has: accounts with unread counts, the
/// shared lists with counts, and taps navigate. A column on iPad, a sheet on iPhone.
struct SidebarRoot: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            FlintBar(
                title: String(localized: "Flint", table: "Sidebar"),
                leading: { closeButton },
                trailing: {
                    FlintIconButton(icon: .settings, label: String(localized: "Settings", table: "Sidebar"), identifier: "sidebar.settings") {
                        model.navigate(to: .settings(.root))
                    }
                })
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(lists, id: \.selection) { entry in
                        row(entry.selection, title: entry.title, count: entry.count)
                    }
                    Text("Accounts", tableName: "Sidebar")
                        .flintText(.label, color: FlintColor.fg3)
                        .padding(.horizontal, FlintMetrics.Space.s4)
                        .padding(.top, FlintMetrics.Space.s5)
                        .padding(.bottom, FlintMetrics.Space.s2)
                    ForEach(model.sidebar?.accounts ?? []) { entry in
                        row(.inbox(entry.id), title: model.accountName(entry.id), count: entry.inboxUnread, address: entry.account.email)
                    }
                }
            }
        }
        .background(FlintColor.plane1)
        .accessibilityIdentifier("sidebar.root")
    }

    @ViewBuilder private var closeButton: some View {
        if model.presented == .sidebar {
            FlintIconButton(icon: .close, label: String(localized: "Close", table: "Sidebar"), identifier: "sidebar.close") { model.navigate(to: .dismiss) }
        }
    }

    private var lists: [(selection: MailboxSelection, title: String, count: Int)] {
        let counts = model.sidebar?.counts ?? SidebarCounts()
        return [
            (.unifiedInbox, model.title(for: .unifiedInbox), counts.inbox),
            (.pinned, model.title(for: .pinned), counts.pinned),
            (.drafts, model.title(for: .drafts), counts.drafts),
            (.sent, model.title(for: .sent), 0),
            (.scheduled, model.title(for: .scheduled), counts.scheduled),
            (.snoozed, model.title(for: .snoozed), counts.snoozed),
            (.trash, model.title(for: .trash), 0),
        ]
    }

    private func row(_ selection: MailboxSelection, title: String, count: Int, address: String? = nil) -> some View {
        Button { model.navigate(to: .mailbox(selection)) } label: {
            HStack(spacing: FlintMetrics.Space.s3) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).flintText(model.mailbox == selection ? .bodyStrong : .body)
                    if let address { Text(address).flintText(.data, color: FlintColor.fg3) }
                }
                Spacer()
                if count > 0 { Text("\(count)").flintText(.data, color: FlintColor.fg2) }
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            .frame(maxWidth: .infinity, minHeight: FlintMetrics.Size.touch, alignment: .leading)
            .background(model.mailbox == selection ? FlintColor.active : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("sidebar.row.\(selection.identifier)")
    }
}

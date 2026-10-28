import FlintModel
import SwiftUI

/// The list's bar: menu, title, search, compose and a menu. While selecting it shows the count and Select all; inside a bundle it
/// has a back button.
struct InboxTopBar: View {
    let viewModel: InboxViewModel
    let columns: Bool
    @Environment(AppModel.self) private var model

    var body: some View {
        if viewModel.isSelecting {
            FlintBar(
                title: String(localized: "\(viewModel.selection.count) selected", table: "Inbox"),
                leading: {
                    FlintIconButton(icon: .close, label: String(localized: "Cancel selection", table: "Inbox"), identifier: "inbox.selectCancel") {
                        viewModel.endSelecting()
                    }
                },
                trailing: {
                    Button { viewModel.selectAll() } label: {
                        Text("Select all", tableName: "Inbox").flintText(.bodyStrong, color: FlintColor.accent)
                            .frame(minHeight: FlintMetrics.Size.touch).padding(.horizontal, FlintMetrics.Space.s2)
                    }
                    .buttonStyle(FlintPressStyle())
                    .accessibilityIdentifier("inbox.selectAll")
                })
        } else if viewModel.category != nil {
            FlintBar(
                title: viewModel.title, subtitle: model.title(for: model.mailbox),
                leading: {
                    FlintIconButton(icon: .arrowLeft, label: String(localized: "Back to inbox", table: "Inbox"), identifier: "inbox.back") {
                        viewModel.category = nil
                    }
                },
                trailing: {})
        } else {
            FlintBar(
                title: viewModel.title,
                leading: {
                    FlintIconButton(icon: .menu, label: String(localized: "Mailboxes", table: "Inbox"), identifier: "inbox.menu") {
                        model.toggleSidebar(columns: columns)
                    }
                },
                trailing: {
                    FlintIconButton(icon: .search, label: String(localized: "Search", table: "Inbox"), identifier: "inbox.search") {
                        model.navigate(to: .search(nil))
                    }
                    FlintIconButton(icon: .compose, label: String(localized: "New message", table: "Inbox"), identifier: "inbox.compose") {
                        model.startCompose()
                    }
                    moreMenu
                })
        }
    }

    private var moreMenu: some View {
        Menu {
            if model.mailbox != .scheduled {
                Button { viewModel.selectMode = true } label: { Text("Select", tableName: "Inbox") }
                    .accessibilityIdentifier("inbox.select")
            }
            Button { viewModel.picker = .swipeSettings } label: { Text("Swipe actions", tableName: "Inbox") }
                .accessibilityIdentifier("inbox.swipeSettings")
        } label: {
            FlintIconView(icon: .more, size: 18, color: FlintColor.fg2)
                .frame(width: FlintMetrics.Size.touch, height: FlintMetrics.Size.touch)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(String(localized: "More", table: "Inbox"))
        .accessibilityIdentifier("inbox.more")
    }
}

import FlintModel
import SwiftUI

/// PLACEHOLDER (track 3C replaces this file). Lists the selected mailbox from `AppModel` so the shell shows real data:
/// threads for most lists, scheduled sends for Scheduled. Tapping a row opens the thread.
struct InboxRoot: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var items: [ThreadListItem]?
    @State private var scheduled: [ScheduledSend] = []
    @State private var error: (any Error)?

    var body: some View {
        VStack(spacing: 0) {
            FlintBar(
                title: model.title(for: model.mailbox),
                leading: {
                    FlintIconButton(icon: .menu, label: String(localized: "Mailboxes", table: "Inbox"), identifier: "inbox.menu") {
                        model.toggleSidebar(columns: sizeClass == .regular)
                    }
                },
                trailing: {
                    FlintIconButton(icon: .search, label: String(localized: "Search", table: "Inbox"), identifier: "inbox.search") { model.navigate(to: .search(nil)) }
                    FlintIconButton(icon: .compose, label: String(localized: "New message", table: "Inbox"), identifier: "inbox.compose") { model.startCompose() }
                })
            if let error { ErrorBanner(error: error, identifier: "inbox.error") }
            content
        }
        .background(FlintColor.plane1)
        .task(id: model.mailbox) { await watch() }
        .accessibilityIdentifier("inbox.root")
    }

    @ViewBuilder private var content: some View {
        if model.mailbox == .scheduled {
            scheduledList
        } else if let items {
            if items.isEmpty {
                FlintEmptyState(icon: .inbox, title: String(localized: "Nothing here", table: "Inbox"), identifier: "inbox.empty")
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(items) { item in
                            Button { model.navigate(to: .thread(item.id)) } label: { FlintRow(item: item) }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("inbox.row.\(item.id)")
                        }
                    }
                }
                .refreshable { await model.syncNow() }
            }
        } else {
            ScrollView { SkeletonRows() }
        }
    }

    private var scheduledList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(scheduled) { send in
                    FlintRow(
                        senderName: FlintFormat.participants(send.to), senderAddress: send.to.first?.address ?? "", subject: send.subject,
                        time: FlintTime.current.listTime(send.sendAt))
                        .accessibilityIdentifier("inbox.scheduled.\(send.id)")
                }
            }
        }
    }

    private func watch() async {
        items = nil
        error = nil
        if model.mailbox == .scheduled {
            do { for try await list in model.scheduled() { scheduled = list } } catch { self.error = error }
            return
        }
        guard let query = model.threadQuery(for: model.mailbox) else { return }
        do { for try await page in model.threadPages(query) { items = page.items } } catch { self.error = error }
    }
}

private extension FlintRow {
    init(item: ThreadListItem) {
        let who = item.participants.first
        self.init(
            senderName: FlintFormat.participants(item.participants), senderAddress: who?.address ?? "", subject: item.subject,
            preview: item.snippet, time: FlintTime.current.listTime(item.lastDate), isUnread: item.unreadCount > 0, isPinned: item.pinned,
            hasAttachment: item.hasAttachments, messageCount: item.messageCount)
    }
}

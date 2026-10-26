import FlintModel
import SwiftUI

/// Move-to-folder picker for the folders and labels of the account the selected conversations belong to.
struct InboxMoveSheet: View {
    let rows: [ThreadListItem]
    let viewModel: InboxViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var folders: [Folder]?
    @State private var failed = false

    private var accountId: AccountID? {
        let accounts = Set(rows.map(\.accountId))
        return accounts.count == 1 ? accounts.first : nil
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "Move to", table: "Inbox"), identifier: "inbox.move") { dismiss() }
            content
        }
        .background(FlintColor.plane1)
        .presentationDetents([.medium, .large])
        .task { await load() }
        .accessibilityIdentifier("inbox.move.root")
    }

    @ViewBuilder private var content: some View {
        if accountId == nil {
            FlintEmptyState(
                icon: .folder, title: String(localized: "Pick one account", table: "Inbox"),
                message: String(localized: "Folders belong to an account. Select conversations from a single account to move them.", table: "Inbox"),
                identifier: "inbox.move.mixed")
        } else if failed {
            ErrorBanner(message: String(localized: "Couldn't load folders.", table: "Inbox"), retryTitle: String(localized: "Try again", table: "Inbox"), identifier: "inbox.move.error") {
                Task { await load() }
            }
            Spacer()
        } else if let folders {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(folders) { folder in
                        Button { choose(folder) } label: {
                            HStack(spacing: FlintMetrics.Space.s3) {
                                FlintIconView(icon: .folder, size: 16, color: FlintColor.fg3)
                                Text(folder.name).flintText(.body)
                                Spacer()
                            }
                            .padding(.horizontal, FlintMetrics.Space.s4)
                            .frame(minHeight: FlintMetrics.Size.touch)
                            .contentShape(Rectangle())
                            .overlay(alignment: .bottom) { FlintHairline() }
                        }
                        .buttonStyle(FlintPressStyle(radius: 0))
                        .accessibilityIdentifier("inbox.move.folder.\(folder.id)")
                    }
                }
            }
        } else {
            ScrollView { SkeletonRows(count: 5, density: .compact) }
        }
    }

    private func load() async {
        guard let accountId else { return }
        failed = false
        do {
            let all = try await viewModel.model.folders(accountId: accountId)
            folders = all.filter { $0.role != .inbox }
        } catch {
            failed = true
        }
    }

    private func choose(_ folder: Folder) {
        dismiss()
        Task { await viewModel.move(rows, to: folder) }
    }
}

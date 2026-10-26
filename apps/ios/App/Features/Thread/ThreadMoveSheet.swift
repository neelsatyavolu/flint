import FlintModel
import SwiftUI

/// Move-to-folder picker for the open conversation: the folders and labels of its account, the same list the inbox offers.
struct ThreadMoveSheet: View {
    let threadId: ThreadID
    let accountId: AccountID
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var folders: [Folder]?
    @State private var failed = false

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "Move to", table: "Thread"), identifier: "thread.move") { dismiss() }
            content
        }
        .background(FlintColor.plane1)
        .presentationDetents([.medium, .large])
        .task { await load() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("thread.move.root")
    }

    @ViewBuilder private var content: some View {
        if failed {
            ErrorBanner(message: String(localized: "Couldn't load folders.", table: "Thread"), retryTitle: String(localized: "Try again", table: "Thread"), identifier: "thread.move.error") {
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
                        .accessibilityIdentifier("thread.move.folder.\(folder.id)")
                    }
                }
            }
        } else {
            ScrollView { SkeletonRows(count: 5, density: .compact) }
        }
    }

    private func load() async {
        failed = false
        do { folders = try await app.folders(accountId: accountId).filter { $0.role != .inbox } } catch { failed = true }
    }

    private func choose(_ folder: Folder) {
        dismiss()
        Task { await app.move([threadId], to: folder) }
    }
}

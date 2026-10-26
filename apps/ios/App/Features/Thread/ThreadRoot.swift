import FlintModel
import SwiftUI

/// PLACEHOLDER (track 3D replaces this file). Reads the open thread from `AppModel` and shows each message as a 12 px card
/// with its sender, time and the start of its text.
struct ThreadRoot: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var detail: ThreadDetail?
    @State private var error: (any Error)?

    var body: some View {
        VStack(spacing: 0) {
            FlintBar(
                title: detail?.subject ?? "",
                leading: {
                    if sizeClass != .regular {
                        FlintIconButton(icon: .arrowLeft, label: String(localized: "Back", table: "Thread"), identifier: "thread.back") { model.navigate(to: .dismiss) }
                    }
                },
                trailing: { EmptyView() })
            if let error { ErrorBanner(error: error, identifier: "thread.error") }
            if let detail {
                ScrollView {
                    LazyVStack(spacing: FlintMetrics.Space.s3) {
                        ForEach(detail.messages) { message in card(message) }
                    }
                    .padding(FlintMetrics.Space.s4)
                }
            } else {
                Spacer()
            }
        }
        .background(FlintColor.plane2)
        .task(id: model.openThread) { await watch() }
        .accessibilityIdentifier("thread.root")
    }

    private func card(_ message: MessageView) -> some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
            HStack {
                Text(FlintFormat.participants(message.from)).flintText(.bodyStrong)
                Spacer()
                Text(FlintTime.current.fullDate(message.date)).flintText(.data, color: FlintColor.fg3)
            }
            Text(String((message.text ?? message.snippet).prefix(400))).flintText(.message, color: FlintColor.fg2)
        }
        .padding(FlintMetrics.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FlintColor.plane1, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.card))
        .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.card).stroke(FlintColor.line, lineWidth: 1))
        .accessibilityIdentifier("thread.message.\(message.id)")
    }

    private func watch() async {
        detail = nil
        error = nil
        guard let id = model.openThread else { return }
        do { for try await value in model.threadStream(id) { detail = value } } catch { self.error = error }
    }
}

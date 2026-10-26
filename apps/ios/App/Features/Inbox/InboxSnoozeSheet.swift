import FlintModel
import SwiftUI

/// Snooze picker: the desktop's presets (later today, tomorrow morning, this weekend, next week) and a date and time of your own.
struct InboxSnoozeSheet: View {
    let ids: [ThreadID]
    let viewModel: InboxViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var custom = false
    @State private var date = Date().addingTimeInterval(3600 * 24)

    private let now = Date()
    private var presets: [TimePreset] { SnoozePresets().resolve(now: now) }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "Snooze until", table: "Inbox"), identifier: "inbox.snooze") { dismiss() }
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(presets) { preset in
                        row(preset.label, time: SnoozePresets().formatTime(preset.at, now: now), id: preset.id.rawValue) { choose(preset.at) }
                    }
                    row(String(localized: "Pick a date and time", table: "Inbox"), time: nil, id: "custom") { custom.toggle() }
                    if custom { picker }
                }
            }
        }
        .background(FlintColor.plane1)
        .presentationDetents([.medium, .large])
        .accessibilityIdentifier("inbox.snooze.root")
    }

    private var picker: some View {
        VStack(spacing: FlintMetrics.Space.s3) {
            DatePicker("", selection: $date, in: now..., displayedComponents: [.date, .hourAndMinute])
                .datePickerStyle(.graphical)
                .labelsHidden()
                .tint(FlintColor.accent)
                .accessibilityIdentifier("inbox.snooze.date")
            Button { choose(date) } label: { Text("Snooze", tableName: "Inbox").frame(maxWidth: .infinity) }
                .buttonStyle(FlintButtonStyle(kind: .primary))
                .accessibilityIdentifier("inbox.snooze.confirm")
        }
        .padding(FlintMetrics.Space.s4)
    }

    private func row(_ title: String, time: String?, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title).flintText(.body)
                Spacer()
                if let time { Text(time).flintText(.data, color: FlintColor.fg3) }
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            .frame(minHeight: FlintMetrics.Size.touch)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) { FlintHairline() }
        }
        .buttonStyle(FlintPressStyle(radius: 0))
        .accessibilityIdentifier("inbox.snooze.\(id)")
    }

    private func choose(_ when: Date) {
        dismiss()
        Task { await viewModel.snooze(ids, until: when) }
    }
}

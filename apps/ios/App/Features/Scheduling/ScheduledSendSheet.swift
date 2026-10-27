import FlintModel
import SwiftUI

/// A message waiting in Scheduled: when it goes, a new time, or take it back into the composer.
struct ScheduledSendSheet: View {
    let send: ScheduledSend
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var changing = false

    private var when: String {
        SnoozePresets().formatTime(Date(timeIntervalSince1970: Double(send.sendAt) / 1000), now: Date())
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "Scheduled message", table: "Scheduling"), identifier: "scheduled") { dismiss() }
            ScrollView {
                VStack(spacing: 0) {
                    summary
                    row(String(localized: "Change time", table: "Scheduling"), id: "change") { changing = true }
                    row(String(localized: "Edit message", table: "Scheduling"), id: "edit") {
                        dismiss()
                        Task { await app.undoSend(scheduledId: send.id) }
                    }
                    Text("Edit takes it out of Scheduled and opens it in the composer.", tableName: "Scheduling")
                        .flintText(.body, color: FlintColor.fg3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(FlintMetrics.Space.s4)
                }
            }
        }
        .background(FlintColor.plane1)
        .presentationBackground(FlintColor.plane1)
        .presentationDetents([.medium, .large])
        .sheet(isPresented: $changing) {
            TimePickerSheet(kind: .sendLater, identifier: "scheduled.time") { date in
                dismiss()
                Task { await app.rescheduleSend(scheduledId: send.id, to: EpochMs((date.timeIntervalSince1970 * 1000).rounded())) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("scheduled.root")
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s1) {
            Text(FlintFormat.participants(send.to)).flintText(.bodyMedium)
            Text(send.subject.isEmpty ? String(localized: "(no subject)", table: "Scheduling") : send.subject)
                .flintText(.body, color: FlintColor.fg2)
            Text(when).flintText(.data, color: FlintColor.fg3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(FlintMetrics.Space.s4)
        .overlay(alignment: .bottom) { FlintHairline() }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("scheduled.summary")
    }

    private func row(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title).flintText(.body)
                Spacer()
                FlintIconView(icon: .chevronRight, size: 14, color: FlintColor.fg3)
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            .frame(minHeight: FlintMetrics.Size.touch)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) { FlintHairline() }
        }
        .buttonStyle(FlintPressStyle(radius: 0))
        .accessibilityIdentifier("scheduled.\(id)")
    }
}

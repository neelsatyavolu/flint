import SwiftUI

/// Send later: the same presets as snooze (later today, tomorrow morning, this weekend, next week) and a date and time.
struct ScheduleSheet: View {
    let onPick: (Date) -> Void
    let now: Date
    @Environment(\.dismiss) private var dismiss
    @State private var custom: Date

    private let presets = SnoozePresets()

    init(now: Date = Date(), onPick: @escaping (Date) -> Void) {
        self.now = now
        self.onPick = onPick
        _custom = State(initialValue: Calendar.current.date(byAdding: .hour, value: 1, to: now) ?? now)
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "Send later", table: "Composer"), identifier: "composer.schedule.sheet") { dismiss() }
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(presets.resolve(now: now)) { preset in
                        Button { pick(preset.at) } label: {
                            HStack {
                                Text(preset.label).flintText(.body)
                                Spacer()
                                Text(presets.formatTime(preset.at, now: now)).flintText(.data, color: FlintColor.fg3)
                            }
                            .padding(.horizontal, FlintMetrics.Space.s4)
                            .frame(minHeight: FlintMetrics.Size.touch)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(FlintPressStyle(radius: 0))
                        .accessibilityIdentifier("composer.schedule.\(preset.id.rawValue)")
                        FlintHairline()
                    }
                    VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
                        Text("Pick a date and time", tableName: "Composer").flintText(.label)
                        DatePicker(
                            String(localized: "Send at", table: "Composer"), selection: $custom, in: now.addingTimeInterval(60)...,
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        .datePickerStyle(.graphical)
                        .tint(FlintColor.accent)
                        .accessibilityIdentifier("composer.schedule.picker")
                        Button { pick(custom) } label: {
                            Text("Schedule", tableName: "Composer").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(FlintButtonStyle(kind: .primary))
                        .accessibilityIdentifier("composer.schedule.confirm")
                    }
                    .padding(FlintMetrics.Space.s4)
                }
            }
        }
        .background(FlintColor.plane1)
        .presentationDetents([.medium, .large])
        .presentationBackground(FlintColor.plane1)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("composer.schedule.root")
    }

    private func pick(_ date: Date) {
        dismiss()
        onPick(date)
    }
}

import SwiftUI

/// The one time picker: presets for the kind, then a date and time of your own. Snooze, send later and follow-up reminders
/// all open it. `identifier` prefixes every accessibility id (`<id>.root`, `<id>.<preset>`, `<id>.custom`, `<id>.confirm`).
struct TimePickerSheet: View {
    let kind: TimePickerKind
    let identifier: String
    /// The reminder already set, so the picker can show it and offer to remove it.
    var current: Date?
    var onClear: (() -> Void)?
    let onPick: (Date) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var customOpen = false
    @State private var custom: Date
    private let now: Date

    init(kind: TimePickerKind, identifier: String, current: Date? = nil, now: Date = Date(), onClear: (() -> Void)? = nil, onPick: @escaping (Date) -> Void) {
        self.kind = kind
        self.identifier = identifier
        self.current = current
        self.now = now
        self.onClear = onClear
        self.onPick = onPick
        _custom = State(initialValue: kind.initialCustom(now: now))
    }

    private var presets: SnoozePresets { SnoozePresets() }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: kind.title, identifier: identifier) { dismiss() }
            ScrollView {
                VStack(spacing: 0) {
                    if let footnote = kind.footnote {
                        Text(footnote).flintText(.body, color: FlintColor.fg2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(FlintMetrics.Space.s4)
                            .overlay(alignment: .bottom) { FlintHairline() }
                            .accessibilityIdentifier("\(identifier).note")
                    }
                    ForEach(kind.options(now: now)) { option in
                        row(option.label, time: presets.formatTime(option.at, now: now), id: option.id) { choose(option.at) }
                    }
                    row(kind.customTitle, time: nil, id: "custom", expanded: customOpen) { customOpen.toggle() }
                    if customOpen { picker }
                    if let current, let onClear {
                        row(String(localized: "No reminder", table: "Scheduling"), time: presets.formatTime(current, now: now), id: "clear") {
                            dismiss()
                            onClear()
                        }
                    }
                }
            }
        }
        .background(FlintColor.plane1)
        .presentationBackground(FlintColor.plane1)
        .presentationDetents([.medium, .large])
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("\(identifier).root")
    }

    private var picker: some View {
        VStack(spacing: FlintMetrics.Space.s3) {
            DatePicker("", selection: $custom, in: kind.earliest(now: now)..., displayedComponents: [.date, .hourAndMinute])
                .datePickerStyle(.graphical)
                .labelsHidden()
                .tint(FlintColor.accent)
                .accessibilityIdentifier("\(identifier).date")
            Button { choose(custom) } label: { Text(kind.confirmTitle).frame(maxWidth: .infinity) }
                .buttonStyle(FlintButtonStyle(kind: .primary))
                .accessibilityIdentifier("\(identifier).confirm")
        }
        .padding(FlintMetrics.Space.s4)
    }

    private func row(_ title: String, time: String?, id: String, expanded: Bool? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title).flintText(.body)
                Spacer()
                if let time { Text(time).flintText(.data, color: FlintColor.fg3) }
                if let expanded { FlintIconView(icon: expanded ? .chevronDown : .chevronRight, size: 14, color: FlintColor.fg3) }
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            .frame(minHeight: FlintMetrics.Size.touch)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) { FlintHairline() }
        }
        .buttonStyle(FlintPressStyle(radius: 0))
        .accessibilityIdentifier("\(identifier).\(id)")
    }

    private func choose(_ date: Date) {
        dismiss()
        onPick(date)
    }
}

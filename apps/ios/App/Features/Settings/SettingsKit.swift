import SwiftUI

/// A settings page: an opaque bar with a back button, a title, and a scrolling body. The shell hides the system bar.
struct SettingsPage<Content: View, Trailing: View>: View {
    let title: String
    let identifier: String
    var showsBack = true
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            FlintBar(
                title: title,
                leading: {
                    if showsBack {
                        FlintIconButton(icon: .chevronLeft, label: sl("Back"), identifier: "settings.back") { dismiss() }
                    }
                },
                trailing: { trailing })
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    content
                }
                .padding(.bottom, FlintMetrics.Space.s12)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(FlintColor.plane1.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings.\(identifier).root")
    }
}

extension SettingsPage where Trailing == EmptyView {
    init(title: String, identifier: String, showsBack: Bool = true, @ViewBuilder content: () -> Content) {
        self.init(title: title, identifier: identifier, showsBack: showsBack, trailing: { EmptyView() }, content: content)
    }
}

/// A Geist Mono group label with an optional line of explanation under it.
struct SettingsGroup<Content: View>: View {
    let title: String
    var note: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .flintText(.label)
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, FlintMetrics.Space.s4)
                .padding(.top, FlintMetrics.Space.s6)
                .padding(.bottom, note == nil ? FlintMetrics.Space.s2 : FlintMetrics.Space.s1)
            if let note {
                Text(note)
                    .flintText(.body, color: FlintColor.fg3)
                    .padding(.horizontal, FlintMetrics.Space.s4)
                    .padding(.bottom, FlintMetrics.Space.s2)
            }
            FlintHairline()
            content
        }
    }
}

/// A row: optional icon, title and description on the left, a control on the right, a hairline below. At least 44 pt tall.
struct SettingsRowLayout<Trailing: View>: View {
    var icon: FlintIcon?
    let title: String
    var detail: String?
    var titleColor: Color = FlintColor.fg
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: FlintMetrics.Space.s3) {
            if let icon { FlintIconView(icon: icon, size: 18, color: FlintColor.fg2).frame(width: 24) }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).flintText(.bodyMedium, color: titleColor).fixedSize(horizontal: false, vertical: true)
                if let detail {
                    Text(detail).flintText(.body, color: FlintColor.fg3).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: FlintMetrics.Space.s2)
            trailing
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.vertical, FlintMetrics.Space.s2)
        .frame(maxWidth: .infinity, minHeight: FlintMetrics.Size.touch + FlintMetrics.Space.s2, alignment: .leading)
        .overlay(alignment: .bottom) { FlintHairline() }
    }
}

/// A row with a flat on/off switch.
struct SettingsToggleRow: View {
    var icon: FlintIcon?
    let title: String
    var detail: String?
    @Binding var isOn: Bool
    let identifier: String
    var disabled = false

    var body: some View {
        SettingsRowLayout(icon: icon, title: title, detail: detail) {
            Toggle(title, isOn: $isOn)
                .labelsHidden()
                .toggleStyle(FlintToggleStyle())
                .accessibilityIdentifier(identifier)
        }
        .opacity(disabled ? 0.4 : 1)
        .disabled(disabled)
    }
}

/// Flat switch: a 44 by 26 track with a square thumb, accent when on. No glass, no shadow.
struct FlintToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            ZStack(alignment: configuration.isOn ? .trailing : .leading) {
                RoundedRectangle(cornerRadius: FlintMetrics.Radius.control)
                    .fill(configuration.isOn ? FlintColor.accent : FlintColor.active)
                RoundedRectangle(cornerRadius: 2)
                    .fill(configuration.isOn ? FlintColor.accentFg : FlintColor.fg2)
                    .frame(width: 18, height: 18)
                    .padding(4)
            }
            .frame(width: 46, height: 26)
            .frame(width: FlintMetrics.Size.touch + 4, height: FlintMetrics.Size.touch)
            .contentShape(Rectangle())
            .flintAnimation(value: configuration.isOn)
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label } }
    }
}

/// A row that opens a menu of choices; the current choice shows on the right.
struct SettingsChoiceRow<Value: Hashable>: View {
    var icon: FlintIcon?
    let title: String
    var detail: String?
    @Binding var selection: Value
    let choices: [(value: Value, label: String)]
    let identifier: String

    var body: some View {
        SettingsRowLayout(icon: icon, title: title, detail: detail) {
            Menu {
                Picker(title, selection: $selection) {
                    ForEach(choices.indices, id: \.self) { Text(choices[$0].label).tag(choices[$0].value) }
                }
            } label: {
                HStack(spacing: FlintMetrics.Space.s1) {
                    Text(currentLabel).flintText(.data, color: FlintColor.fg2).lineLimit(1)
                    FlintIconView(icon: .chevronDown, size: 14, color: FlintColor.fg3)
                }
                .frame(minHeight: FlintMetrics.Size.touch)
                .contentShape(Rectangle())
            }
            .accessibilityLabel(title)
            .accessibilityValue(currentLabel)
            .accessibilityIdentifier(identifier)
        }
    }

    private var currentLabel: String { choices.first { $0.value == selection }?.label ?? "" }
}

/// A row that pushes another screen.
struct SettingsLinkRow<Destination: Hashable>: View {
    var icon: FlintIcon?
    let title: String
    var detail: String?
    var value: String?
    let destination: Destination
    let identifier: String

    var body: some View {
        NavigationLink(value: destination) {
            SettingsRowLayout(icon: icon, title: title, detail: detail) {
                HStack(spacing: FlintMetrics.Space.s1) {
                    if let value { Text(value).flintText(.data, color: FlintColor.fg3).lineLimit(1) }
                    FlintIconView(icon: .chevronRight, size: 16, color: FlintColor.fg3)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(FlintPressStyle(radius: 0))
        .accessibilityIdentifier(identifier)
    }
}

/// A text field with a mono label above it, on a flat `plane2` fill with a 4 pt corner.
struct SettingsField: View {
    let label: String
    @Binding var text: String
    var prompt = ""
    var keyboard: UIKeyboardType = .default
    var invalid = false
    let identifier: String

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s1) {
            Text(label).flintText(.label)
            TextField("", text: $text, prompt: Text(prompt).foregroundStyle(FlintColor.fg4))
                .flintText(.body)
                .keyboardType(keyboard)
                .textInputAutocapitalization(keyboard == .default ? .sentences : .never)
                .autocorrectionDisabled(keyboard != .default)
                .padding(.horizontal, FlintMetrics.Space.s3)
                .frame(minHeight: FlintMetrics.Size.touch)
                .background(FlintColor.plane2, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
                .overlay { RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(invalid ? FlintColor.danger : FlintColor.line, lineWidth: 1) }
                .accessibilityLabel(label)
                .accessibilityIdentifier(identifier)
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.top, FlintMetrics.Space.s3)
    }
}

/// A multi-line text box styled like `SettingsField`.
struct SettingsTextBox: View {
    let label: String
    @Binding var text: String
    var minHeight: CGFloat = 160
    let identifier: String

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s1) {
            Text(label).flintText(.label)
            TextEditor(text: $text)
                .flintText(.body)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, FlintMetrics.Space.s2)
                .padding(.vertical, FlintMetrics.Space.s1)
                .frame(minHeight: minHeight)
                .background(FlintColor.plane2, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
                .overlay { RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(FlintColor.line, lineWidth: 1) }
                .accessibilityLabel(label)
                .accessibilityIdentifier(identifier)
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.top, FlintMetrics.Space.s3)
    }
}

/// An inline message in the error color under a field.
struct SettingsFieldError: View {
    let message: String?

    var body: some View {
        if let message {
            Text(message)
                .flintText(.body, color: FlintColor.danger)
                .padding(.horizontal, FlintMetrics.Space.s4)
                .padding(.top, FlintMetrics.Space.s1)
                .accessibilityIdentifier("settings.fieldError")
        }
    }
}

/// A full-width flat button row for save and destructive actions.
struct SettingsButton: View {
    enum Kind { case primary, ghost, danger }
    let title: String
    var kind: Kind = .ghost
    var disabled = false
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .flintText(.bodyStrong, color: kind == .danger ? FlintColor.danger : nil)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(FlintButtonStyle(kind: kind == .primary ? .primary : .ghost))
        .disabled(disabled)
        .accessibilityIdentifier(identifier)
    }
}

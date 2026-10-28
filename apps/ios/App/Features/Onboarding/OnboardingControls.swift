import SwiftUI

/// A labelled text input: Geist Mono label above a flat field with a 4 pt radius and a 1 pt border that turns accent on focus.
struct OnboardingField: View {
    let label: String
    @Binding var text: String
    var prompt = ""
    var identifier: String
    var secure = false
    var keyboard: UIKeyboardType = .default
    var contentType: UITextContentType?
    var capitalization: TextInputAutocapitalization = .never
    var submitLabel: SubmitLabel = .next
    var onSubmit: () -> Void = {}
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
            Text(label).flintText(.label, color: FlintColor.fg3)
            input
                .focused($focused)
                .flintText(.message)
                .keyboardType(keyboard)
                .textContentType(contentType)
                .textInputAutocapitalization(capitalization)
                .autocorrectionDisabled()
                .submitLabel(submitLabel)
                .onSubmit(onSubmit)
                .padding(.horizontal, FlintMetrics.Space.s3)
                .frame(minHeight: FlintMetrics.Size.touch)
                .background(FlintColor.plane2, in: shape)
                .overlay { shape.stroke(focused ? FlintColor.accent : FlintColor.lineStrong, lineWidth: 1) }
                .accessibilityIdentifier(identifier)
        }
        .onChange(of: focused) { was, now in if was && !now { onSubmit() } }
    }

    @ViewBuilder private var input: some View {
        if secure {
            SecureField("", text: $text, prompt: Text(prompt).foregroundStyle(FlintColor.fg4))
        } else {
            TextField("", text: $text, prompt: Text(prompt).foregroundStyle(FlintColor.fg4))
        }
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: FlintMetrics.Radius.control) }
}

/// A full-width choice on the welcome step: icon, title, one line of help, chevron. Disabled rows read as unavailable.
struct OnboardingChoiceRow: View {
    let icon: FlintIcon
    let title: String
    let detail: String
    var identifier: String
    var isBusy = false
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: FlintMetrics.Space.s3) {
                FlintIconView(icon: icon, size: 20, color: isEnabled ? FlintColor.fg : FlintColor.fg4)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).flintText(.bodyStrong, color: isEnabled ? FlintColor.fg : FlintColor.fg3)
                    Text(detail).flintText(.body, color: FlintColor.fg3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if isBusy {
                    ProgressView().controlSize(.small).tint(FlintColor.fg3)
                } else {
                    FlintIconView(icon: .chevronRight, size: 16, color: FlintColor.fg4)
                }
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            .padding(.vertical, FlintMetrics.Space.s3)
            .frame(minHeight: 64)
            .contentShape(Rectangle())
        }
        .buttonStyle(FlintPressStyle(radius: 0))
        .accessibilityIdentifier(identifier)
    }
}

/// A flat message block with a left rule: `warn` for advice that does not stop setup, `danger` for failures, neutral otherwise.
struct OnboardingNotice: View {
    enum Tone { case neutral, warn, danger }

    let tone: Tone
    let text: String
    var identifier: String

    var body: some View {
        HStack(alignment: .top, spacing: FlintMetrics.Space.s3) {
            FlintIconView(icon: .alert, size: 16, color: color)
            Text(text).flintText(.body, color: FlintColor.fg2).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(FlintMetrics.Space.s3)
        .background(FlintColor.plane2, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
        .overlay(alignment: .leading) { color.frame(width: 2) }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }

    private var color: Color {
        switch tone {
        case .neutral: FlintColor.fg3
        case .warn: FlintColor.warn
        case .danger: FlintColor.danger
        }
    }
}

/// A switch row with a title and one line of help.
struct OnboardingToggleRow: View {
    let title: String
    let detail: String
    @Binding var isOn: Bool
    var identifier: String

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).flintText(.bodyStrong)
                Text(detail).flintText(.body, color: FlintColor.fg3)
            }
        }
        .toggleStyle(FlintToggleStyle(showsLabel: true))
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.vertical, FlintMetrics.Space.s3)
        .frame(minHeight: 64)
        .accessibilityIdentifier(identifier)
    }
}

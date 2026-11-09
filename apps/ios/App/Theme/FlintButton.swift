import SwiftUI

/// Buttons from DESIGN.md "Buttons and inputs". One primary per view. 44 pt tall for touch, 4 pt radius.
/// `primary` is the accent button, `secondary` the ink button (`--primary`); never both in one view.
/// Disabled is `--fg-4` text on `--active`, never an opacity fade.
struct FlintButtonStyle: ButtonStyle {
    enum Kind: Sendable { case primary, secondary, ghost }

    var kind: Kind = .secondary
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .flintText(.bodyStrong, color: foreground)
            .padding(.horizontal, FlintMetrics.Space.s4)
            .frame(minHeight: FlintMetrics.Size.touch)
            .background(background(pressed: configuration.isPressed), in: shape)
            .overlay { if kind == .ghost { shape.stroke(FlintColor.lineStrong, lineWidth: 1) } }
            .contentShape(shape)
            .flintAnimation(value: configuration.isPressed)
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: FlintMetrics.Radius.control) }

    private var foreground: Color {
        guard isEnabled else { return FlintColor.fg4 }
        return switch kind {
        case .primary: FlintColor.accentFg
        case .secondary: FlintColor.plane1
        case .ghost: FlintColor.fg
        }
    }

    private func background(pressed: Bool) -> Color {
        guard isEnabled else { return kind == .ghost ? .clear : FlintColor.active }
        return switch kind {
        case .primary: pressed ? FlintColor.accent.opacity(0.85) : FlintColor.accent
        case .secondary: pressed ? FlintColor.fg.opacity(0.85) : FlintColor.fg
        case .ghost: pressed ? FlintColor.active : .clear
        }
    }
}

import SwiftUI

/// Opaque top bar that replaces the system navigation bar, which iOS 26 draws as Liquid Glass (DESIGN.md
/// forbids glass, blur and shadows). A plane fill reaching under the status bar, a title left-aligned, a hairline
/// below. Screens hide the system bar with `.toolbar(.hidden, for: .navigationBar)`.
struct FlintBar<Leading: View, Trailing: View>: View {
    let title: String
    var subtitle: String?
    var plane: Color = FlintColor.plane1
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: FlintMetrics.Space.s1) {
            leading
            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .flintText(.title)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle)
                        .flintText(.body, color: FlintColor.fg3)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, FlintMetrics.Space.s2)
            trailing
        }
        .padding(.horizontal, FlintMetrics.Space.s2)
        .frame(minHeight: FlintMetrics.Size.bar)
        .background(plane.ignoresSafeArea(edges: .top))
        .overlay(alignment: .bottom) { FlintHairline() }
    }
}

extension FlintBar where Leading == EmptyView {
    init(title: String, subtitle: String? = nil, plane: Color = FlintColor.plane1, @ViewBuilder trailing: () -> Trailing) {
        self.init(title: title, subtitle: subtitle, plane: plane, leading: { EmptyView() }, trailing: trailing)
    }
}

extension FlintBar where Leading == EmptyView, Trailing == EmptyView {
    init(title: String, subtitle: String? = nil, plane: Color = FlintColor.plane1) {
        self.init(title: title, subtitle: subtitle, plane: plane, leading: { EmptyView() }, trailing: { EmptyView() })
    }
}

/// 1 pixel-ish `--line` rule between planes and rows.
struct FlintHairline: View {
    var color: Color = FlintColor.line
    @Environment(\.displayScale) private var scale

    var body: some View {
        color.frame(height: 1 / max(scale, 1))
    }
}

/// Icon-only button: 18 pt glyph in a 44 pt touch target, `--fg-2`, a flat `--active` fill while pressed.
struct FlintIconButton: View {
    let icon: FlintIcon
    let label: String
    var color: Color = FlintColor.fg2
    var identifier: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            FlintIconView(icon: icon, size: 18, color: color)
                .frame(width: FlintMetrics.Size.touch, height: FlintMetrics.Size.touch)
                .contentShape(Rectangle())
        }
        .buttonStyle(FlintPressStyle())
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier ?? "icon.\(icon.rawValue)")
    }
}

/// Pressed state is a flat `--active` fill, never a scale or shadow.
struct FlintPressStyle: ButtonStyle {
    var radius: CGFloat = FlintMetrics.Radius.control

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? FlintColor.active : .clear, in: RoundedRectangle(cornerRadius: radius))
            .flintAnimation(value: configuration.isPressed)
    }
}

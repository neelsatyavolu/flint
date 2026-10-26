import SwiftUI

/// Flat switch: a 46 by 26 track with a square thumb, accent when on. No glass, no shadow. Settings hides the label and lays
/// out its own row; `showsLabel` puts the label at the leading edge and the switch at the trailing edge, and the whole row
/// toggles, like a system toggle.
struct FlintToggleStyle: ToggleStyle {
    var showsLabel = false

    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(spacing: FlintMetrics.Space.s3) {
                if showsLabel { configuration.label.frame(maxWidth: .infinity, alignment: .leading) }
                track(isOn: configuration.isOn)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label } }
    }

    private func track(isOn: Bool) -> some View {
        ZStack(alignment: isOn ? .trailing : .leading) {
            RoundedRectangle(cornerRadius: FlintMetrics.Radius.control)
                .fill(isOn ? FlintColor.accent : FlintColor.active)
            RoundedRectangle(cornerRadius: 2)
                .fill(isOn ? FlintColor.accentFg : FlintColor.fg2)
                .frame(width: 18, height: 18)
                .padding(4)
        }
        .frame(width: 46, height: 26)
        .frame(width: FlintMetrics.Size.touch + 4, height: FlintMetrics.Size.touch)
        .flintAnimation(value: isOn)
    }
}

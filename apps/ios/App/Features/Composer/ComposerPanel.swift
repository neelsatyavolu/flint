import SwiftUI

/// The composer as a small floating panel at the bottom right, for iPad and other wide windows, instead of a sheet.
/// The shell places it with `ComposerPanelHost` (see HANDOFF); it holds the same `ComposerRoot` as the iPhone sheet.
struct ComposerPanel: View {
    static let width: CGFloat = 460
    static let height: CGFloat = 640

    var body: some View {
        ComposerRoot()
            .frame(width: Self.width, height: Self.height)
            .background(FlintColor.plane1)
            .clipShape(RoundedRectangle(cornerRadius: FlintMetrics.Radius.card))
            .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.card).stroke(FlintColor.lineStrong, lineWidth: 1))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("composer.panel")
    }
}

/// Puts the panel in the bottom right corner of whatever it overlays, clear of the safe area. The rest of the screen stays
/// usable behind it: only the panel takes touches.
struct ComposerPanelHost: View {
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Color.clear.allowsHitTesting(false)
            ComposerPanel()
                .padding(FlintMetrics.Space.s4)
        }
    }
}

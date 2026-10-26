import SwiftUI

/// The composer as a small floating panel at the bottom right, for iPad and other wide windows, instead of a sheet.
/// The shell places it with `ComposerPanelHost` (see HANDOFF); it holds the same `ComposerRoot` as the iPhone sheet.
struct ComposerPanel: View {
    static let width: CGFloat = 460
    static let height: CGFloat = 640
    /// Shorter when the window (less the keyboard) has no room for the full panel.
    var height: CGFloat = Self.height

    var body: some View {
        ComposerRoot()
            .frame(width: Self.width, height: height)
            .background(FlintColor.plane1)
            .clipShape(RoundedRectangle(cornerRadius: FlintMetrics.Radius.card))
            .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.card).stroke(FlintColor.lineStrong, lineWidth: 1))
            // No identifier of its own: a container with one child hands its id to that child and would hide `composer.root`.
    }
}

/// Puts the panel in the bottom right corner of whatever it overlays, clear of the safe area. The rest of the screen stays
/// usable behind it: only the panel takes touches.
struct ComposerPanelHost: View {
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottomTrailing) {
                Color.clear.allowsHitTesting(false)
                ComposerPanel(height: min(ComposerPanel.height, max(320, proxy.size.height - 2 * FlintMetrics.Space.s4)))
                    .padding(FlintMetrics.Space.s4)
            }
        }
    }
}

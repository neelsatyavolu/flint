import SwiftUI

/// App root. Until the feature tracks land it shows the empty state, or the theme gallery in Debug builds
/// and with `-FlintThemeGallery YES`.
struct RootView: View {
    var body: some View {
        if FlintDebugFlags.themeGallery() {
            ThemeGallery()
        } else {
            EmptyStateView()
        }
    }
}

/// The Flint mark at 96 pt in `--fg-4` on the reader plane, nothing else (DESIGN.md "Reader, empty state").
struct EmptyStateView: View {
    var body: some View {
        ZStack {
            FlintColor.plane2.ignoresSafeArea()
            FlintMark()
                .stroke(FlintColor.fg4, style: StrokeStyle(lineWidth: 2, lineJoin: .round))
                .frame(width: 96, height: 96)
                .accessibilityHidden(true)
        }
        .accessibilityIdentifier("shell.empty")
    }
}

/// The faceted stone outline from the desktop app icon, in a unit square.
struct FlintMark: Shape {
    func path(in rect: CGRect) -> Path {
        let points: [(CGFloat, CGFloat)] = [(470, 250), (690, 330), (760, 560), (610, 780), (380, 740), (270, 520), (330, 330)]
        let minX: CGFloat = 270, minY: CGFloat = 250, span: CGFloat = 530
        func map(_ p: (CGFloat, CGFloat)) -> CGPoint {
            CGPoint(x: rect.minX + (p.0 - minX) / span * rect.width, y: rect.minY + (p.1 - minY) / span * rect.height)
        }
        var path = Path()
        path.addLines(points.map(map))
        path.closeSubpath()
        path.move(to: map((560, 470)))
        for p in [points[0], points[1], points[2], points[3], points[4], points[5]] {
            path.addLine(to: map(p)); path.move(to: map((560, 470)))
        }
        return path
    }
}

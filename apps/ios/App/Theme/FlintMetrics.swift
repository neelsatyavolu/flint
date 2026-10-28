import SwiftUI

/// Spacing, radius and motion from DESIGN.md sections 4 and 7.
enum FlintMetrics {
    /// 4px grid: 4, 8, 12, 16, 20, 24, 32, 48.
    enum Space {
        static let s1: CGFloat = 4
        static let s2: CGFloat = 8
        static let s3: CGFloat = 12
        static let s4: CGFloat = 16
        static let s5: CGFloat = 20
        static let s6: CGFloat = 24
        static let s8: CGFloat = 32
        static let s12: CGFloat = 48
    }

    /// Planes, rows and panes are square (0).
    enum Radius {
        static let control: CGFloat = 4
        static let card: CGFloat = 12
    }

    enum Size {
        /// Touch targets are 44pt on iOS even where desktop controls are 28 or 32.
        static let touch: CGFloat = 44
        static let bar: CGFloat = 52
        static let rowComfortable: CGFloat = 76
        static let rowCompact: CGFloat = 56
        static let hairline: CGFloat = 1
    }

    /// 120 ms for hover, press and focus, 180 ms for panels. Zero under Reduce Motion.
    enum Motion {
        static let fast = 0.12
        static let panel = 0.18
        static let collapse = 0.16
    }
}

extension View {
    /// Applies `animation` unless Reduce Motion is on.
    func flintAnimation<V: Equatable>(_ duration: Double = FlintMetrics.Motion.fast, value: V) -> some View {
        modifier(FlintAnimationModifier(duration: duration, value: value))
    }
}

private struct FlintAnimationModifier<V: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let duration: Double
    let value: V

    func body(content: Content) -> some View {
        content.animation(reduceMotion ? nil : .timingCurve(0.2, 0, 0, 1, duration: duration), value: value)
    }
}

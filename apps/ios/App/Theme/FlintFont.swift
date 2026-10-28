import SwiftUI
import UIKit

/// Type roles from DESIGN.md section 3. Sizes and line heights are the desktop values in points; every role
/// scales with Dynamic Type relative to a system text style.
enum FlintFontRole: CaseIterable, Sendable {
    case body, bodyMedium, bodyStrong, title, subject, compose, data, label, prose, message, settingTitle

    enum Face: String, CaseIterable, Sendable {
        case geistRegular = "Geist-Regular"
        case geistMedium = "Geist-Medium"
        case geistSemiBold = "Geist-SemiBold"
        case monoRegular = "GeistMono-Regular"
        case monoMedium = "GeistMono-Medium"
        case newsreader = "Newsreader-Regular"
    }

    var face: Face {
        switch self {
        case .body, .message: .geistRegular
        case .bodyMedium: .geistMedium
        case .bodyStrong, .title, .subject, .compose, .settingTitle: .geistSemiBold
        case .data: .monoRegular
        case .label: .monoMedium
        case .prose: .newsreader
        }
    }

    var size: CGFloat {
        switch self {
        case .body, .bodyMedium, .bodyStrong: 13.5
        case .title: 15
        case .subject: 21
        case .compose: 24
        case .data: 11.5
        case .label: 11
        case .prose: 16.5
        case .message, .settingTitle: 14.5
        }
    }

    /// Line height in points.
    var lineHeight: CGFloat {
        switch self {
        case .body, .bodyMedium, .bodyStrong: 20
        case .title, .message, .settingTitle: 22
        case .subject: 28
        case .compose: 32
        case .data, .label: 16
        case .prose: 26
        }
    }

    var textStyle: Font.TextStyle {
        switch self {
        case .subject: .title2
        case .compose: .title
        case .title, .settingTitle: .headline
        case .data, .label: .footnote
        default: .body
        }
    }

    var isUppercase: Bool { self == .label }
    /// `0.08em` on labels.
    var tracking: CGFloat { self == .label ? 0.08 * size : 0 }
    /// Times, counts and the numerals of UI text line up in columns.
    var usesTabularDigits: Bool { true }

    var font: Font { .custom(face.rawValue, size: size, relativeTo: textStyle) }

    /// Extra line spacing so the rendered line box matches `lineHeight` at the default text size.
    fileprivate var extraLineSpacing: CGFloat {
        let natural = UIFont(name: face.rawValue, size: size)?.lineHeight ?? size * 1.2
        return max(0, lineHeight - natural)
    }
}

extension View {
    /// Font, line height, tracking and case for a role. Color is separate: pass one, or inherit.
    func flintText(_ role: FlintFontRole, color: Color? = nil) -> some View {
        modifier(FlintTextModifier(role: role, color: color))
    }
}

private struct FlintTextModifier: ViewModifier {
    let role: FlintFontRole
    let color: Color?
    @ScaledMetric private var lineSpacing: CGFloat

    init(role: FlintFontRole, color: Color?) {
        self.role = role
        self.color = color
        _lineSpacing = ScaledMetric(wrappedValue: role.extraLineSpacing, relativeTo: role.textStyle)
    }

    func body(content: Content) -> some View {
        content
            .font(role.font)
            .monospacedDigit()
            .lineSpacing(lineSpacing)
            .tracking(role.tracking)
            .textCase(role.isUppercase ? .uppercase : nil)
            .foregroundStyle(color ?? (role == .label ? FlintColor.fg3 : FlintColor.fg))
    }
}

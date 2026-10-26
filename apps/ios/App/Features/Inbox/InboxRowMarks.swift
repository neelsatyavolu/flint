import FlintModel
import SwiftUI

/// A small outlined mono label on a row: the invite chip, the verification code chip.
struct InboxChip: View {
    enum Style { case plain, accent }

    let text: String
    var icon: FlintIcon?
    var style: Style = .plain

    var body: some View {
        HStack(spacing: 3) {
            if let icon { FlintIconView(icon: icon, size: 11, color: foreground) }
            Text(text).flintText(.data, color: foreground).lineLimit(1)
        }
        .padding(.horizontal, 6)
        .frame(height: 18)
        .background(style == .accent ? FlintColor.accentSoft : .clear, in: shape)
        .overlay(shape.stroke(style == .accent ? FlintColor.accent.opacity(0.5) : FlintColor.lineStrong, lineWidth: 1))
        .fixedSize()
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: FlintMetrics.Radius.control) }
    private var foreground: Color { style == .accent ? FlintColor.accent : FlintColor.fg2 }
}

/// The read receipt on a sent conversation: one grey check when sent, a green double check once someone opened it.
struct ReceiptCheck: View {
    let summary: ReceiptSummary

    var read: Bool { summary.opened > 0 || summary.status == .replied }
    var several: Bool { summary.total > 1 }

    var label: String {
        if read {
            if several { return String(localized: "Opened by \(summary.opened) of \(summary.total)", table: "Inbox") }
            return summary.status == .replied ? String(localized: "Replied", table: "Inbox") : String(localized: "Opened", table: "Inbox")
        }
        if summary.status == .unknowable { return String(localized: "Can't confirm opens", table: "Inbox") }
        return several ? String(localized: "Not opened yet by any of \(summary.total)", table: "Inbox") : String(localized: "Not opened yet", table: "Inbox")
    }

    private var tone: Color {
        if read { return FlintColor.ok }
        return summary.status == .unknowable ? FlintColor.warn : FlintColor.fg3
    }

    var body: some View {
        HStack(spacing: 2) {
            ZStack(alignment: .leading) {
                FlintIconView(icon: .check, size: 12, color: tone)
                if read { FlintIconView(icon: .check, size: 12, color: tone).offset(x: 4) }
            }
            .frame(width: read ? 16 : 12, height: 12)
            if several { Text("\(summary.opened)/\(summary.total)").flintText(.data, color: tone) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// The unread dot, drawn in the row's left gutter.
struct UnreadDot: View {
    var body: some View {
        Circle().fill(FlintColor.accent).frame(width: 6, height: 6).accessibilityHidden(true)
    }
}

/// An account color from `Account.color` ("#RRGGBB"), or nil when it is not a color.
enum AccountColor {
    static func color(_ hex: String) -> Color? {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        return Color(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}

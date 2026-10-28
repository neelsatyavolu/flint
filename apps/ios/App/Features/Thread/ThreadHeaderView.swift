import FlintModel
import SwiftUI

/// Subject and chips: pinned, muted, snoozed, category, account, and Unsubscribe when a message offers it.
struct ThreadHeaderView: View {
    let detail: ThreadDetail
    let accounts: [Account]
    let unsubscribeFrom: MessageView?
    let onUnsubscribe: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
            Text(detail.subject.isEmpty ? String(localized: "(no subject)", table: "Thread") : detail.subject)
                .flintText(.subject).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("thread.subject")
            if hasChips { chips }
        }
        .padding(.horizontal, FlintMetrics.Space.s1)
    }

    private var snoozed: Bool { (detail.snoozedUntil ?? 0) > Int(Date().timeIntervalSince1970 * 1000) }
    private var account: Account? { accounts.count > 1 ? accounts.first { $0.id == detail.accountId } : nil }
    private var hasChips: Bool { detail.pinned || detail.muted || snoozed || detail.category != .people || account != nil || unsubscribeFrom != nil }

    private var chips: some View {
        FlowRow(spacing: FlintMetrics.Space.s2) {
            if detail.pinned { ThreadChip(text: String(localized: "Pinned", table: "Thread"), icon: .pin).accessibilityIdentifier("thread.chip.pinned") }
            if detail.muted { ThreadChip(text: String(localized: "Muted", table: "Thread"), icon: .bell).accessibilityIdentifier("thread.chip.muted") }
            if snoozed, let until = detail.snoozedUntil {
                let when = SnoozePresets().formatTime(Date(timeIntervalSince1970: Double(until) / 1000), now: Date())
                ThreadChip(text: String(localized: "Snoozed until \(when)", table: "Thread"), icon: .clock, accent: true).accessibilityIdentifier("thread.chip.snoozed")
            }
            if detail.category != .people { ThreadChip(text: ThreadAction.title(of: detail.category)).accessibilityIdentifier("thread.chip.category") }
            if let account { ThreadChip(text: account.email, dot: account.email).accessibilityLabel(account.email).accessibilityIdentifier("thread.chip.account") }
            if unsubscribeFrom != nil {
                Button(action: onUnsubscribe) { ThreadChip(text: String(localized: "Unsubscribe", table: "Thread"), tappable: true) }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("thread.unsubscribe")
            }
        }
    }
}

/// A small mono label with a hairline outline, like the desktop `Badge`.
struct ThreadChip: View {
    let text: String
    var icon: FlintIcon?
    var dot: String?
    var accent = false
    var tappable = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: FlintMetrics.Space.s1) {
            if let icon { FlintIconView(icon: icon, size: 11, color: accent ? FlintColor.accent : FlintColor.fg3) }
            if let dot {
                let tint = AvatarTint.color(for: dot, dark: scheme == .dark)
                Circle().fill(Color(red: tint.r, green: tint.g, blue: tint.b)).frame(width: 8, height: 8)
            }
            Text(text).flintText(.label, color: accent ? FlintColor.accent : (tappable ? FlintColor.fg2 : FlintColor.fg3)).lineLimit(1)
        }
        .padding(.horizontal, FlintMetrics.Space.s2)
        .frame(minHeight: tappable ? FlintMetrics.Size.touch - 12 : 24)
        .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(FlintColor.line, lineWidth: 1))
        .contentShape(Rectangle())
    }
}

/// Lays children out in rows that wrap, left to right.
struct FlowRow: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, origin) in result.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + rowHeight), origins)
    }
}

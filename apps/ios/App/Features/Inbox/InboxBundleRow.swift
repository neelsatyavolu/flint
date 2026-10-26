import FlintModel
import SwiftUI

/// The Notifications or Newsletters row of the smart inbox: a glyph, the title with its unread count, the time and the latest sender
/// and subject. Tapping opens the bundle as its own list.
struct InboxBundleRow: View {
    let bundle: InboxBundle
    let compact: Bool
    var onOpen: () -> Void = {}

    private var unread: Bool { bundle.unreadCount > 0 }
    private var glyph: FlintIcon { bundle.category == .notifications ? .bell : .newspaper }
    private var diameter: CGFloat { compact ? 24 : 32 }

    var body: some View {
        HStack(alignment: .top, spacing: FlintMetrics.Space.s3) {
            ZStack {
                Circle().fill(FlintColor.active)
                FlintIconView(icon: glyph, size: compact ? 13 : 16, color: FlintColor.fg2)
            }
            .frame(width: diameter, height: diameter)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: FlintMetrics.Space.s2) {
                    Text(ThreadAction.title(of: bundle.category)).flintText(unread ? .bodyStrong : .bodyMedium).lineLimit(1)
                    if unread {
                        Text("\(bundle.unreadCount) new", tableName: "Inbox").flintText(.data, color: FlintColor.accent)
                    }
                    Spacer(minLength: FlintMetrics.Space.s2)
                    Text(FlintTime.current.listTime(bundle.lastDate)).flintText(.data, color: FlintColor.fg3).lineLimit(1)
                    FlintIconView(icon: .chevronRight, size: 12, color: FlintColor.fg3)
                }
                if !compact, let first = bundle.latest.first {
                    (Text(FlintFormat.displayName(first.from)).font(FlintFontRole.bodyMedium.font) + Text(" ") + Text(first.subject))
                        .flintText(.body, color: FlintColor.fg3)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, FlintMetrics.Space.s3)
        .padding(.horizontal, FlintMetrics.Space.s4)
        .frame(maxWidth: .infinity, minHeight: compact ? FlintMetrics.Size.rowCompact : 60, alignment: .topLeading)
        .background(FlintColor.plane1)
        .overlay(alignment: .topLeading) {
            if unread { UnreadDot().padding(.leading, 5).padding(.top, FlintMetrics.Space.s3 + 7) }
        }
        .overlay(alignment: .bottom) { FlintHairline() }
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("inbox.bundle.\(bundle.category.rawValue)")
    }

    private var label: String {
        var parts = [ThreadAction.title(of: bundle.category)]
        if unread { parts.append(String(localized: "\(bundle.unreadCount) new", table: "Inbox")) }
        if let first = bundle.latest.first { parts.append("\(FlintFormat.displayName(first.from)), \(first.subject)") }
        return parts.joined(separator: ", ")
    }
}

import SwiftUI

/// Mail list row (DESIGN.md "List"): avatar, sender and time, subject with count and paperclip, one-line preview,
/// a 6 pt accent dot in the left gutter when unread, a 2 pt accent bar and soft fill when selected.
/// It is display only: callers wrap it in a Button or NavigationLink and own swipe actions.
struct FlintRow: View {
    enum Density: Sendable { case comfortable, compact }

    let senderName: String
    let senderAddress: String
    let subject: String
    var preview: String = ""
    let time: String
    var isUnread = false
    var isPinned = false
    var isSelected = false
    var hasAttachment = false
    var messageCount = 1
    var density: Density = .comfortable

    var body: some View {
        HStack(alignment: .top, spacing: FlintMetrics.Space.s3) {
            FlintAvatar(address: senderAddress, name: senderName, size: density == .compact ? .s24 : .s32)
            VStack(alignment: .leading, spacing: 0) {
                firstLine
                secondLine
                if density == .comfortable, !preview.isEmpty {
                    Text(preview).flintText(.body, color: FlintColor.fg3).lineLimit(1)
                }
            }
        }
        .padding(.vertical, FlintMetrics.Space.s3)
        .padding(.leading, FlintMetrics.Space.s4)
        .padding(.trailing, FlintMetrics.Space.s4)
        .frame(maxWidth: .infinity, minHeight: density == .compact ? FlintMetrics.Size.rowCompact : FlintMetrics.Size.rowComfortable, alignment: .topLeading)
        .background(isSelected ? FlintColor.accentSoft : .clear)
        .overlay(alignment: .leading) {
            if isSelected { FlintColor.accent.frame(width: 2) }
        }
        .overlay(alignment: .leading) {
            if isUnread {
                Circle().fill(FlintColor.accent).frame(width: 6, height: 6)
                    .padding(.leading, 5)
                    .padding(.top, FlintMetrics.Space.s3 + 7)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .overlay(alignment: .bottom) { FlintHairline() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var firstLine: some View {
        HStack(spacing: FlintMetrics.Space.s2) {
            Text(senderName.isEmpty ? senderAddress : senderName)
                .flintText(isUnread ? .bodyStrong : .bodyMedium)
                .lineLimit(1)
            Spacer(minLength: FlintMetrics.Space.s2)
            if isPinned { FlintIconView(icon: .pin, size: 12, color: FlintColor.fg3) }
            Text(time).flintText(.data, color: FlintColor.fg3).lineLimit(1)
        }
    }

    private var secondLine: some View {
        HStack(spacing: FlintMetrics.Space.s2) {
            Text(subject)
                .flintText(.body, color: isUnread ? FlintColor.fg : FlintColor.fg2)
                .lineLimit(1)
            Spacer(minLength: FlintMetrics.Space.s1)
            if messageCount > 1 {
                Text("\(messageCount)")
                    .flintText(.data, color: FlintColor.fg2)
                    .padding(.horizontal, 6)
                    .background(FlintColor.active, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
            }
            if hasAttachment { FlintIconView(icon: .paperclip, size: 12, color: FlintColor.fg3) }
        }
    }

    private var accessibilityText: String {
        var parts: [String] = []
        if isUnread { parts.append("Unread") }
        if isPinned { parts.append("Pinned") }
        parts.append("From \(senderName.isEmpty ? senderAddress : senderName)")
        parts.append(subject)
        if !preview.isEmpty { parts.append(preview) }
        if messageCount > 1 { parts.append("\(messageCount) messages") }
        if hasAttachment { parts.append("Has attachment") }
        parts.append(time)
        return parts.joined(separator: ", ")
    }
}

/// Loading placeholder with the same geometry as `FlintRow`, so nothing shifts when data arrives.
/// Static on purpose: no shimmer, no spinner over content.
struct FlintSkeletonRow: View {
    var density: FlintRow.Density = .comfortable

    var body: some View {
        HStack(alignment: .top, spacing: FlintMetrics.Space.s3) {
            Circle().fill(FlintColor.active).frame(width: density == .compact ? 24 : 32, height: density == .compact ? 24 : 32)
            VStack(alignment: .leading, spacing: 6) {
                bar(width: 120)
                bar(width: 200)
                if density == .comfortable { bar(width: 160) }
            }
            .padding(.top, 4)
        }
        .padding(.vertical, FlintMetrics.Space.s3)
        .padding(.horizontal, FlintMetrics.Space.s4)
        .frame(maxWidth: .infinity, minHeight: density == .compact ? FlintMetrics.Size.rowCompact : FlintMetrics.Size.rowComfortable, alignment: .topLeading)
        .overlay(alignment: .bottom) { FlintHairline() }
        .accessibilityHidden(true)
    }

    private func bar(width: CGFloat) -> some View {
        FlintColor.active.frame(width: width, height: 8)
    }
}

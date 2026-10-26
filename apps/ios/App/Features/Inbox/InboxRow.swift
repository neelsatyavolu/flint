import FlintModel
import SwiftUI
import UIKit

/// One conversation in the list. Display plus two gestures: tap opens (or toggles in selection mode), tapping the avatar selects.
/// Swipe actions are added by the list, which owns the row's context.
struct InboxRow: View {
    let item: ThreadListItem
    let settings: Settings
    var accountColor: String?
    var isSelecting = false
    var isSelected = false
    /// The conversation shown in the thread column on iPad.
    var isOpen = false
    var onOpen: () -> Void = {}
    var onToggle: () -> Void = {}
    var onCopyCode: (String) -> Void = { _ in }
    /// Search shows the same row under its own identifier.
    var identifier: String?

    private var compact: Bool { settings.appearance.density == .compact }
    private var unread: Bool { item.unreadCount > 0 }
    private var showAvatar: Bool { settings.appearance.avatars != .off }
    private var previewLines: Int { compact ? 0 : settings.appearance.previewLines }

    var body: some View {
        let time = InboxRowText.time(item)
        HStack(alignment: .top, spacing: FlintMetrics.Space.s3) {
            if showAvatar { lead.onTapGesture(perform: onToggle) }
            VStack(alignment: .leading, spacing: 0) {
                firstLine(time)
                secondLine
                if previewLines > 0, !item.snippet.isEmpty {
                    Text(item.snippet).flintText(.body, color: FlintColor.fg3).lineLimit(previewLines)
                }
            }
        }
        .padding(.vertical, FlintMetrics.Space.s3)
        .padding(.horizontal, FlintMetrics.Space.s4)
        .frame(maxWidth: .infinity, minHeight: compact ? FlintMetrics.Size.rowCompact : FlintMetrics.Size.rowComfortable, alignment: .topLeading)
        .background(isSelected || isOpen ? FlintColor.accentSoft : FlintColor.plane1)
        .overlay(alignment: .leading) { if isSelected || isOpen { FlintColor.accent.frame(width: 2) } }
        .overlay(alignment: .topLeading) {
            if unread { UnreadDot().padding(.leading, 5).padding(.top, FlintMetrics.Space.s3 + 7) }
        }
        .overlay(alignment: .bottom) { FlintHairline() }
        .contentShape(Rectangle())
        .onTapGesture(perform: isSelecting ? onToggle : onOpen)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(InboxRowText.accessibility(item, time: time.text))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier(identifier ?? "inbox.row.\(item.id)")
        .accessibilityAction { isSelecting ? onToggle() : onOpen() }
        .accessibilityAction(named: Text("Select", tableName: "Inbox"), onToggle)
    }

    @ViewBuilder private var lead: some View {
        let size: FlintAvatar.Size = compact ? .s24 : .s32
        let who = InboxRowText.lead(item)
        ZStack {
            if isSelected {
                Circle().fill(FlintColor.accent)
                FlintIconView(icon: .check, size: 14, color: FlintColor.accentFg)
            } else if isSelecting {
                Circle().stroke(FlintColor.lineStrong, lineWidth: 1.5)
            } else {
                FlintAvatar(address: who.address, name: who.name, size: size)
            }
        }
        .frame(width: size.rawValue, height: size.rawValue)
    }

    private func firstLine(_ time: (text: String, snoozed: Bool)) -> some View {
        let who = InboxRowText.sender(item)
        return HStack(spacing: FlintMetrics.Space.s2) {
            Group {
                if who.isDraft {
                    Text("Draft", tableName: "Inbox").foregroundStyle(FlintColor.danger) + Text(who.text.isEmpty ? "" : ", ")
                        + Text(who.text)
                } else {
                    Text(who.text.isEmpty ? InboxRowText.lead(item).address : who.text)
                }
            }
            .flintText(unread ? .bodyStrong : .bodyMedium)
            .lineLimit(1)
            Spacer(minLength: FlintMetrics.Space.s2)
            if item.muted { FlintIconView(icon: .bell, size: 12, color: FlintColor.fg4) }
            if item.pinned { FlintIconView(icon: .pin, size: 12, color: FlintColor.fg3) }
            if let receipt = item.receipt { ReceiptCheck(summary: receipt) }
            HStack(spacing: 3) {
                if time.snoozed { FlintIconView(icon: .clock, size: 12, color: FlintColor.warn) }
                Text(time.text).flintText(.data, color: time.snoozed ? FlintColor.warn : FlintColor.fg3).lineLimit(1)
            }
        }
    }

    private var secondLine: some View {
        HStack(spacing: FlintMetrics.Space.s2) {
            Text(InboxRowText.subject(item))
                .flintText(.body, color: unread ? FlintColor.fg : FlintColor.fg2)
                .lineLimit(1)
            Spacer(minLength: FlintMetrics.Space.s1)
            if let badge = InboxRowText.liveCode(item) {
                InboxChip(text: badge.code, style: .accent)
                    .onTapGesture { onCopyCode(badge.code) }
                    .accessibilityIdentifier("inbox.code.\(item.id)")
            }
            if InboxRowText.isInvite(item) { InboxChip(text: String(localized: "Invite", table: "Inbox"), icon: .calendar) }
            if item.messageCount > 1 {
                Text("\(item.messageCount)")
                    .flintText(.data, color: FlintColor.fg2)
                    .padding(.horizontal, 6)
                    .background(FlintColor.active, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
            }
            if item.hasAttachments { FlintIconView(icon: .paperclip, size: 12, color: FlintColor.fg3) }
            if let hex = accountColor, let color = AccountColor.color(hex) { Circle().fill(color).frame(width: 8, height: 8) }
        }
    }
}

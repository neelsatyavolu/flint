import FlintModel
import SwiftUI

/// An older message folded to one row: avatar, sender, the start of its text and the time. It never touches the HTML.
struct CollapsedMessageRow: View {
    let message: MessageView
    let vm: ThreadModel

    var body: some View {
        let sender = message.from.first ?? Address(address: "")
        Button { vm.toggle(message.id) } label: {
            HStack(spacing: FlintMetrics.Space.s3) {
                FlintAvatar(address: sender.address, name: sender.name, size: .s24)
                Text(message.isFromMe ? String(localized: "me", table: "Thread") : FlintFormat.displayName(sender))
                    .flintText(message.seen ? .bodyMedium : .bodyStrong).lineLimit(1)
                Text(message.snippet).flintText(.body, color: FlintColor.fg3).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                Text(FlintTime.current.listTime(message.date)).flintText(.data, color: FlintColor.fg3).lineLimit(1)
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            .frame(minHeight: FlintMetrics.Size.touch + 4)
            .background(FlintColor.plane1, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.card))
            .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.card).stroke(FlintColor.line, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(FlintFormat.displayName(sender)), \(message.snippet)")
        .accessibilityHint(String(localized: "Shows the message", table: "Thread"))
        .accessibilityIdentifier("thread.collapsed.\(message.id)")
    }
}

/// An expanded message as a 12 px card: header, code banner, body, attachments, read receipt.
struct MessageCardView: View {
    let message: MessageView
    let vm: ThreadModel
    let selfAddresses: [String]
    let onCompose: (ComposeMode, MessageView) -> Void
    let onOpenAttachment: (AttachmentInfo) -> Void
    let onUnsubscribe: (MessageView) -> Void
    let onBlock: (String) -> Void
    let onMarkUnread: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
            header
            if let badge = message.verificationCode, !badge.used { CodeBanner(badge: badge) }
            MessageBodyView(message: message, vm: vm)
            AttachmentList(attachments: message.attachments.filter { !$0.inline }, onOpen: onOpenAttachment)
            if let receipt = message.receipt { ReceiptRow(receipt: receipt, messageId: message.id) }
        }
        .padding(FlintMetrics.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FlintColor.plane1, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.card))
        .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.card).stroke(FlintColor.line, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("thread.message.\(message.id)")
    }

    // MARK: Header

    private var sender: Address { message.from.first ?? Address(address: "") }
    private var name: String { message.isFromMe ? String(localized: "me", table: "Thread") : FlintFormat.displayName(sender) }

    private var header: some View {
        HStack(alignment: .top, spacing: FlintMetrics.Space.s3) {
            Button { vm.toggle(message.id) } label: {
                HStack(alignment: .top, spacing: FlintMetrics.Space.s3) {
                    FlintAvatar(address: sender.address, name: sender.name, size: .s32)
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: FlintMetrics.Space.s2) {
                            Text(name).flintText(.bodyStrong).lineLimit(1)
                            if let receipt = message.receipt { MessageReceiptCheck(receipt: receipt) }
                        }
                        Text(recipientsLine).flintText(.body, color: FlintColor.fg3).lineLimit(1)
                        Text(FlintTime.current.fullDate(message.date)).flintText(.data, color: FlintColor.fg3).fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(name), \(recipientsLine), \(FlintTime.current.fullDate(message.date))")
            .accessibilityHint(String(localized: "Folds the message", table: "Thread"))
            .accessibilityIdentifier("thread.messageHeader.\(message.id)")
            menu
        }
    }

    private var recipientsLine: String {
        FlintFormat.recipients(message.to + message.cc, selfAddresses: selfAddresses)
    }

    private var menu: some View {
        Menu {
            if ThreadLogic.hasSingleRecipient(message, selfAddresses: selfAddresses) {
                Button(String(localized: "Reply", table: "Thread")) { onCompose(.reply, message) }
            }
            Button(String(localized: "Reply all", table: "Thread")) { onCompose(.replyAll, message) }
            Button(String(localized: "Forward", table: "Thread")) { onCompose(.forward, message) }
            Divider()
            Button(String(localized: "Mark thread unread", table: "Thread")) { onMarkUnread() }
            if message.unsubscribe != nil {
                Button(String(localized: "Unsubscribe", table: "Thread")) { onUnsubscribe(message) }
            }
            if !message.isFromMe, !sender.address.isEmpty {
                Button(String(localized: "Block sender", table: "Thread"), role: .destructive) { onBlock(sender.address) }
            }
        } label: {
            FlintIconView(icon: .more, size: 18, color: FlintColor.fg2)
                .frame(width: FlintMetrics.Size.touch, height: FlintMetrics.Size.touch)
                .contentShape(Rectangle())
        }
        .padding(.trailing, -FlintMetrics.Space.s3)
        .padding(.top, -FlintMetrics.Space.s3)
        .accessibilityLabel(String(localized: "More", table: "Thread"))
        .accessibilityIdentifier("thread.messageMenu.\(message.id)")
    }
}

/// A verification code found in the message, with a one-tap copy.
struct CodeBanner: View {
    let badge: CodeBadge
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: FlintMetrics.Space.s3) {
            VStack(alignment: .leading, spacing: 0) {
                Text(String(localized: "Verification code", table: "Thread")).flintText(.label)
                Text(badge.code).flintText(.title).textSelection(.enabled)
            }
            Spacer()
            Button(String(localized: "Copy", table: "Thread")) {
                UIPasteboard.general.setItems([["public.utf8-plain-text": badge.code]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)])
                app.toasts.show(String(localized: "Copied", table: "Thread"))
            }
            .buttonStyle(FlintButtonStyle(kind: .ghost))
            .accessibilityIdentifier("thread.copyCode")
        }
        .padding(FlintMetrics.Space.s3)
        .background(FlintColor.accentSoft, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("thread.codeBanner")
    }
}

import FlintModel
import QuickLook
import SwiftUI

/// The conversation: header, message cards (older ones folded), sends waiting in their undo window, and the reply dock.
/// Third column on iPad, pushed on iPhone; it reads `model.openThread`.
struct ThreadRoot: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var vm = ThreadModel()
    @State private var error: (any Error)?
    @State private var previewURL: URL?
    @State private var confirmUnsubscribe: MessageView?

    var body: some View {
        VStack(spacing: 0) {
            bar
            if let error { ErrorBanner(error: error, identifier: "thread.error") }
            if let detail = vm.detail { content(detail) } else { Spacer() }
            if let target = ThreadLogic.replyTarget(vm.messages) {
                ReplyDock(target: target, selfAddresses: selfAddresses, onCompose: compose)
            }
        }
        .background(FlintColor.plane2)
        .task(id: model.openThread) { await watch() }
        .task(id: model.openThread) { if let id = model.openThread { await vm.watchQueued(model, threadId: id) } }
        .quickLookPreview($previewURL)
        .sheet(isPresented: safariBinding) { if let url = vm.safariURL { SafariView(url: url).ignoresSafeArea() } }
        .alert(item: $vm.linkPrompt, content: linkAlert)
        .confirmationDialog(unsubscribeTitle, isPresented: unsubscribeBinding, titleVisibility: .visible, presenting: confirmUnsubscribe) { message in
            Button(String(localized: "Unsubscribe", table: "Thread")) { Task { await unsubscribe(message) } }
            Button(String(localized: "Cancel", table: "Thread"), role: .cancel) {}
        } message: { message in
            if let info = message.unsubscribe { Text(ThreadLogic.unsubscribeExplanation(info)) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("thread.root")
    }

    // MARK: Bar

    private var bar: some View {
        FlintBar(
            title: "",
            leading: {
                if sizeClass != .regular {
                    FlintIconButton(icon: .arrowLeft, label: String(localized: "Back", table: "Thread"), identifier: "thread.back") { model.navigate(to: .dismiss) }
                }
            },
            trailing: {
                if let detail = vm.detail {
                    ThreadToolbar(
                        detail: detail, leavesInbox: ThreadLogic.leavesInbox(model.mailbox), inSpam: model.mailbox == .spam,
                        sender: vm.messages.last { !$0.isFromMe }?.from.first)
                }
            })
    }

    // MARK: Content

    private func content(_ detail: ThreadDetail) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: FlintMetrics.Space.s3) {
                    ThreadHeaderView(
                        detail: detail, accounts: model.accounts, unsubscribeFrom: vm.messages.last { $0.unsubscribe != nil },
                        onUnsubscribe: { confirmUnsubscribe = vm.messages.last { $0.unsubscribe != nil } })
                    ForEach(vm.messages) { message in
                        if vm.expanded.contains(message.id) { card(message) } else { CollapsedMessageRow(message: message, vm: vm) }
                    }
                    ForEach(vm.queued) { reply in
                        QueuedReplyCard(reply: reply) { Task { await model.undoSend(scheduledId: reply.id) } }
                    }
                }
                .padding(FlintMetrics.Space.s4)
            }
            .accessibilityIdentifier("thread.scroll")
            .task(id: detail.id) { await showNewest(proxy, detail) }
        }
    }

    private func card(_ message: MessageView) -> some View {
        MessageCardView(
            message: message, vm: vm, selfAddresses: selfAddresses, onCompose: compose,
            onOpenAttachment: { attachment in Task { await open(attachment) } },
            onUnsubscribe: { confirmUnsubscribe = $0 },
            onBlock: { address in Task { await model.blockSender(address) } },
            onMarkUnread: { Task { _ = await model.markRead([message.threadId], read: false) } })
            .id(message.id)
    }

    // MARK: Behaviour

    private var selfAddresses: [String] { model.accounts.flatMap { [$0.email] + $0.aliases } }

    private func compose(_ mode: ComposeMode, _ message: MessageView) {
        model.startCompose(ThreadLogic.draftInit(mode, messageId: message.id))
    }

    private func watch() async {
        vm.reset()
        error = nil
        guard let id = model.openThread else { return }
        var scheduledRead = false
        do {
            for try await value in model.threadStream(id) {
                vm.apply(value)
                if !scheduledRead { scheduledRead = true; Task { await markReadIfNeeded(value) } }
            }
        } catch { self.error = error }
    }

    /// Marks the conversation read after it opens, as `settings.inbox.markReadOnOpen` says.
    private func markReadIfNeeded(_ detail: ThreadDetail) async {
        guard detail.messages.contains(where: { !$0.seen }) else { return }
        switch model.settings?.inbox.markReadOnOpen ?? .instant {
        case .never: return
        case .delay: try? await Task.sleep(for: .milliseconds(1500))
        case .instant: break
        }
        guard !Task.isCancelled, model.openThread == detail.id else { return }
        _ = await model.markRead([detail.id], read: true)
    }

    /// Opens on the newest message when older ones are folded above it.
    private func showNewest(_ proxy: ScrollViewProxy, _ detail: ThreadDetail) async {
        guard detail.messages.count > 2, let last = detail.messages.last else { return }
        try? await Task.sleep(for: .milliseconds(120))
        proxy.scrollTo(last.id, anchor: .top)
    }

    private func open(_ attachment: AttachmentInfo) async {
        do { previewURL = try await model.attachmentFile(attachment.id) } catch {
            model.toasts.show(String(localized: "Couldn't open that file. Try again.", table: "Thread"), kind: .error)
        }
    }

    private func unsubscribe(_ message: MessageView) async {
        guard let method = await model.unsubscribe(messageId: message.id) else { return }
        switch method {
        case .browser(let url): vm.safariURL = url
        case .oneClick: model.toasts.show(String(localized: "Unsubscribed", table: "Thread"))
        case .mailto: model.toasts.show(String(localized: "Sent an unsubscribe email", table: "Thread"))
        }
    }

    // MARK: Presentation

    private var safariBinding: Binding<Bool> {
        Binding(get: { vm.safariURL != nil }, set: { if !$0 { vm.safariURL = nil } })
    }

    private var unsubscribeBinding: Binding<Bool> {
        Binding(get: { confirmUnsubscribe != nil }, set: { if !$0 { confirmUnsubscribe = nil } })
    }

    private var unsubscribeTitle: String {
        let name = confirmUnsubscribe?.from.first.map(FlintFormat.displayName) ?? String(localized: "this sender", table: "Thread")
        return String(localized: "Unsubscribe from \(name)?", table: "Thread")
    }

    private func linkAlert(_ prompt: LinkPrompt) -> Alert {
        Alert(
            title: Text(String(localized: "Open this link?", table: "Thread")),
            message: Text(String(localized: "The text says \(prompt.shown), but the link goes to \(prompt.url.host ?? prompt.url.absoluteString).", table: "Thread")),
            primaryButton: .default(Text(String(localized: "Open", table: "Thread"))) { vm.confirmLink() },
            secondaryButton: .cancel(Text(String(localized: "Cancel", table: "Thread"))) { vm.linkPrompt = nil })
    }
}

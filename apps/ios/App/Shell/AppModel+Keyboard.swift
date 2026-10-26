import FlintModel
import Foundation

/// What the hardware-keyboard shortcuts do (`FlintCommands`). They work on the open conversation and the list that is showing.
extension AppModel {
    /// Reply or Reply all to the conversation that is open (Cmd-R, Shift-Cmd-R).
    func replyToOpenThread(all: Bool) async {
        guard let id = openThread, let detail = try? await threadDetail(id), let target = ThreadLogic.replyTarget(detail.messages) else { return }
        startCompose(all ? .replyAll(messageId: target.id) : .reply(messageId: target.id))
    }

    /// Archive the open conversation (E). In a list where the conversation is already out of the inbox the toolbar offers
    /// Move to Inbox instead, so the key does nothing there.
    func archiveOpenThread() async {
        guard let id = openThread, !ThreadLogic.leavesInbox(mailbox) else { return }
        await archive([id])
    }

    /// Open the next (J, Down) or previous (K, Up) conversation in the list that is showing.
    func stepThread(by delta: Int) async {
        guard let query = threadQuery(for: mailbox), let page = try? await listThreads(query) else { return }
        guard let id = ThreadStepper.target(in: page.items.map(\.id), from: openThread, delta: delta) else { return }
        navigate(to: .thread(id))
    }
}

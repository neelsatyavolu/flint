import FlintModel
import Foundation

/// What the hardware-keyboard shortcuts do (`FlintCommands`). They work on the open conversation and the list that is showing.
extension AppModel {
    /// Reply or Reply all to the conversation that is open (Cmd-R, Shift-Cmd-R).
    func replyToOpenThread(all: Bool) async {
        guard let id = openThread, let detail = try? await threadDetail(id), let target = ThreadLogic.replyTarget(detail.messages) else { return }
        startCompose(all ? .replyAll(messageId: target.id) : .reply(messageId: target.id))
    }

    /// Archive the open conversation (E). Where the conversation is decides, as for the toolbar: out of the inbox the toolbar
    /// offers Move to Inbox (or Not spam) instead, so the key does nothing.
    func archiveOpenThread() async {
        guard let id = openThread, let detail = try? await threadDetail(id),
              !ThreadLogic.leavesInbox(place: detail.place, selection: mailbox) else { return }
        await archive([id])
    }

    /// Open the next (J, Down) or previous (K, Up) conversation in the list on screen, with its filter, bundle and loaded
    /// rows. Before the list has published anything, the mailbox's first page stands in.
    func stepThread(by delta: Int) async {
        var ids = visibleThreadIds
        if ids.isEmpty, let query = threadQuery(for: mailbox), let page = try? await listThreads(query) { ids = page.items.map(\.id) }
        guard let id = ThreadStepper.target(in: ids, from: openThread, delta: delta) else { return }
        navigate(to: .thread(id))
    }
}

import FlintModel
import SwiftUI

/// The calendar invitation in a message: title, time, place, organizer and the person's answer, with Yes / Maybe / No,
/// Add to Calendar and a join button. Shows nothing for a message without a readable calendar part.
struct InviteCardView: View {
    let message: MessageView
    /// The conversation's messages, so an update or a cancellation beside the original is seen.
    let thread: [MessageView]
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var model = InviteCardModel()

    var body: some View {
        Group {
            if let merged = model.merged, let times = model.times {
                InviteCardContent(
                    messageId: message.id, merged: merged, times: times, model: model,
                    onAnswer: { answer in Task { await model.answer(answer, services: services) } },
                    onAddToCalendar: { Task { await model.addToCalendar(services: services) } },
                    onJoin: { openURL($0) })
            } else {
                // The load below needs a view to hang on to; a Group with nothing in it never runs its task.
                Color.clear.frame(height: 0).accessibilityHidden(true)
            }
        }
        .task(id: loadKey) { await load() }
    }

    private var loadKey: [Int] { thread.compactMap { InviteAttachments.calendarPart(of: $0)?.id } + [message.id] }

    private var services: InviteServices { .live(app) }

    private func load() async {
        let account = app.account(message.accountId)
        let own = account.map { [$0.email] + $0.aliases } ?? []
        await model.load(message: message, thread: thread, accountName: account?.name ?? "", ownAddresses: own, services: services)
    }
}

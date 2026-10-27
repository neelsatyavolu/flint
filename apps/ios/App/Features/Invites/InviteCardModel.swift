import FlintModel
import Foundation
import Observation

/// Which attachment of a message holds its calendar part.
enum InviteAttachments {
    static let maxBytes = 1_000_000

    static func isCalendar(_ attachment: AttachmentInfo) -> Bool {
        let type = attachment.contentType.lowercased()
        let named = attachment.filename.lowercased().hasSuffix(".ics")
        return (type.hasPrefix("text/calendar") || type == "application/ics" || named) && attachment.size <= maxBytes
    }

    static func calendarPart(of message: MessageView) -> AttachmentInfo? { message.attachments.first(where: isCalendar) }
}

/// State of the invite card for one message: the parsed invite merged with what this device knows, the answer being sent and
/// the Add to Calendar step. The view reads it; nothing here touches the interface.
@MainActor @Observable
final class InviteCardModel {
    enum CalendarState: Equatable {
        case idle, adding, added
        case failed(CalendarFailure)
    }

    enum CalendarFailure: Equatable { case denied, other }

    /// Times as text, in the viewer's zone.
    struct Times: Equatable {
        var when: String
        var duration: String?
        /// The organizer's own clock, only when it differs from the viewer's.
        var organizer: String?
    }

    private(set) var merged: MergedInvite?
    private(set) var times: Times?
    private(set) var sending: RSVPAnswer?
    private(set) var calendar: CalendarState = .idle
    var note = ""

    @ObservationIgnored private var source: Source?

    private struct Source {
        var invite: ParsedInvite
        var messageId: Int
        var accountId: AccountID
        var accountName: String
        var ownAddresses: [String]
    }

    private static let siblingLimit = 8

    /// Reads the message's calendar part and those of the thread's other messages (an update or a cancellation usually sits
    /// beside the original), then works out what the card shows. Does nothing for a message without a calendar part.
    func load(message: MessageView, thread: [MessageView], accountName: String, ownAddresses: [String], services: InviteServices) async {
        guard InviteAttachments.calendarPart(of: message) != nil else { merged = nil; return }
        let others = thread.filter { $0.id != message.id && InviteAttachments.calendarPart(of: $0) != nil }.prefix(Self.siblingLimit)
        await read(message, ownAddresses: ownAddresses, services: services)
        for sibling in others { await read(sibling, ownAddresses: ownAddresses, services: services) }
        guard let invite = services.ledger.version(messageId: message.id)?.invite else { merged = nil; return }
        source = Source(invite: invite, messageId: message.id, accountId: message.accountId, accountName: accountName, ownAddresses: ownAddresses)
        refresh(services)
    }

    private func read(_ message: MessageView, ownAddresses: [String], services: InviteServices) async {
        guard services.ledger.version(messageId: message.id) == nil, let part = InviteAttachments.calendarPart(of: message) else { return }
        guard let data = try? await services.fetchAttachment(part.id) else { return }
        let context = InviteParseContext(ownAddresses: ownAddresses, now: services.now())
        guard let invite = InviteParser.parse(data, context: context) else { return }
        services.ledger.record(invite, messageId: message.id, account: message.accountId)
    }

    private func refresh(_ services: InviteServices) {
        guard let source else { return }
        let key = source.invite.eventKey(account: source.accountId)
        merged = InviteMerge.merge(
            source.invite, messageId: source.messageId, versions: services.ledger.versions(forKey: key),
            answer: services.ledger.answer(forKey: key),
            env: InviteMergeEnvironment(now: services.now(), ownAddresses: source.ownAddresses, zone: services.zone()))
        times = merged.map { Self.times($0, now: services.now(), zone: services.zone()) }
        let added = services.ledger.addedSequence(forKey: key)
        if calendar != .adding { calendar = (added ?? -1) >= source.invite.sequence ? .added : .idle }
    }

    private static func times(_ m: MergedInvite, now: Int, zone: String) -> Times {
        let invite = m.invite
        return Times(
            when: InviteFormat.when(start: m.start, end: m.end, allDay: invite.allDay, zone: zone, now: now),
            duration: InviteFormat.duration(start: m.start, end: m.end, allDay: invite.allDay),
            organizer: InviteFormat.organizerTime(start: m.start, end: m.end, allDay: invite.allDay, organizerZone: invite.timeZone, viewerZone: zone))
    }

    // MARK: Answering

    /// Sends the answer as an iMIP REPLY. The card shows the new answer once the reply is queued.
    func answer(_ answer: RSVPAnswer, services: InviteServices) async {
        guard sending == nil, let source, let merged, merged.canAnswer, let invitedAs = source.invite.invitedAs else { return }
        let me = Address(name: source.accountName, address: invitedAs.address)
        let comment = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let reply = try? ImipBuilder.reply(invite: source.invite, attendee: me, answer: answer, note: comment, now: services.now()) else { return }
        sending = answer
        let sent = await services.sendReply(reply, source.accountId, invitedAs.address)
        sending = nil
        guard sent else { return }
        let key = source.invite.eventKey(account: source.accountId)
        services.ledger.setAnswer(
            InviteAnswer(response: answer, note: comment.isEmpty ? nil : comment, sequence: source.invite.sequence, respondedAt: services.now()), forKey: key)
        note = ""
        refresh(services)
    }

    // MARK: Calendar

    /// Adds the event through write-only EventKit access. The person's calendar is never read.
    func addToCalendar(services: InviteServices) async {
        guard calendar != .adding, let source else { return }
        calendar = .adding
        do {
            try await services.calendar.add(CalendarEventDrafts.draft(from: source.invite))
            services.ledger.markAdded(sequence: source.invite.sequence, forKey: source.invite.eventKey(account: source.accountId))
            calendar = .added
        } catch CalendarWriteError.denied {
            calendar = .failed(.denied)
        } catch {
            calendar = .failed(.other)
        }
    }
}

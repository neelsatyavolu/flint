import FlintModel
import Foundation

/// One stored version of an event: the invite and the message that carried it.
struct InviteVersion: Codable, Hashable, Sendable {
    var messageId: Int
    var invite: ParsedInvite
}

/// The person's last answer to an event, as recorded when they sent it.
struct InviteAnswer: Codable, Hashable, Sendable {
    var response: RSVPAnswer
    var note: String?
    var sequence: Int
    var respondedAt: EpochMs
}

struct InviteMergeEnvironment: Sendable {
    var now: EpochMs
    var ownAddresses: [String]
    /// IANA zone for the times in "what changed" and for all-day comparisons.
    var zone: String
}

/// Turns one parse into what the card shows: state, what changed since the previous version, the person's own answer.
/// Pure: the caller gathers the other versions and the recorded answer.
enum InviteMerge {
    private static let versioned: Set<InviteMethod> = [.request, .publish, .cancel]
    private static let day = 86_400_000

    /// Positive when a is the later version of the event: higher SEQUENCE, then later DTSTAMP, then a CANCEL beats a REQUEST.
    static func compare(_ a: ParsedInvite, _ b: ParsedInvite) -> Int {
        if a.sequence != b.sequence { return a.sequence - b.sequence }
        let stampA = a.dtstamp ?? 0
        let stampB = b.dtstamp ?? 0
        if stampA != stampB { return stampA < stampB ? -1 : 1 }
        return (a.method == .cancel ? 1 : 0) - (b.method == .cancel ? 1 : 0)
    }

    // MARK: What changed

    private static func clip(_ s: String?, _ n: Int = 140) -> String? {
        guard let s, s.count > n else { return s }
        return String(s.prefix(n - 1)).trimmingCharacters(in: .whitespaces) + "..."
    }

    static func diff(_ before: ParsedInvite, _ after: ParsedInvite, zone: String, now: Int) -> [InviteChange] {
        var out: [InviteChange] = []
        if before.start != after.start || before.end != after.end || before.allDay != after.allDay {
            out.append(.init(
                field: .time, before: InviteFormat.when(start: before.start, end: before.end, allDay: before.allDay, zone: zone, now: now),
                after: InviteFormat.when(start: after.start, end: after.end, allDay: after.allDay, zone: zone, now: now)))
        }
        if (before.location ?? "") != (after.location ?? "") { out.append(.init(field: .location, before: before.location, after: after.location)) }
        if before.title != after.title { out.append(.init(field: .title, before: before.title, after: after.title)) }
        if let guests = guestChange(before, after) { out.append(guests) }
        if before.recurrence?.summary != after.recurrence?.summary {
            out.append(.init(field: .recurrence, before: before.recurrence?.summary, after: after.recurrence?.summary))
        }
        if before.conference?.url != after.conference?.url {
            out.append(.init(field: .conference, before: before.conference?.label, after: after.conference?.label))
        }
        if (before.description ?? "") != (after.description ?? "") {
            out.append(.init(field: .description, before: clip(before.description), after: clip(after.description)))
        }
        return out
    }

    private static func guestChange(_ before: ParsedInvite, _ after: ParsedInvite) -> InviteChange? {
        let was = Dictionary(before.attendees.map { ($0.address, $0.name.isEmpty ? $0.address : $0.name) }, uniquingKeysWith: { a, _ in a })
        let now = Dictionary(after.attendees.map { ($0.address, $0.name.isEmpty ? $0.address : $0.name) }, uniquingKeysWith: { a, _ in a })
        let added = after.attendees.filter { was[$0.address] == nil }.map { now[$0.address] ?? $0.address }
        let removed = before.attendees.filter { now[$0.address] == nil }.map { was[$0.address] ?? $0.address }
        guard !added.isEmpty || !removed.isEmpty else { return nil }
        func count(_ n: Int) -> String { "\(n) guest\(n == 1 ? "" : "s")" }
        var text = count(now.count)
        if !added.isEmpty { text += ", added \(added.joined(separator: ", "))" }
        if !removed.isEmpty { text += ", removed \(removed.joined(separator: ", "))" }
        return .init(field: .guests, before: count(was.count), after: text)
    }

    // MARK: Series

    private struct Times { var start: Int; var end: Int; var startDate: String?; var endDate: String? }

    /// 00:00 UTC of the viewer's current calendar date: the unit all-day events are stored in.
    static func allDayToday(now: Int, zone: String) -> Int {
        InviteZones.utcEpoch(InviteZones.wall(now, in: zone))
    }

    /// For a series whose first occurrence is past, the occurrence in progress or next. `ended` when none is left.
    private static func effectiveTimes(_ inv: ParsedInvite, now: Int, zone viewer: String) -> (times: Times, ended: Bool) {
        let own = Times(start: inv.start, end: inv.end, startDate: inv.startDate, endDate: inv.endDate)
        let duration = max(0, inv.end - inv.start)
        let after = inv.allDay ? allDayToday(now: now, zone: viewer) - duration + 1 : now - duration
        guard let recurrence = inv.recurrence, inv.recurrenceId == nil, inv.start < after else { return (own, false) }
        let zone = inv.allDay ? "UTC" : inv.timeZone ?? viewer
        guard let rule = RecurrenceRule(recurrence.rrule) else { return (own, false) }
        // Rules we do not expand are treated as still running unless an end date says otherwise.
        guard ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].contains(rule.freq) else {
            let over = InviteRecurrenceMath.seriesEnd(recurrence.rrule, start: InviteZones.wall(inv.start, in: zone), zone: zone, duration: duration).map { $0 < now } ?? false
            return (own, over)
        }
        let wall = InviteZones.wall(inv.start, in: zone)
        guard let next = InviteRecurrenceMath.nextOccurrence(
            recurrence.rrule, start: wall, zone: zone, after: after, excluded: recurrence.excluded, added: recurrence.added)
        else { return (own, true) }
        let end = next + duration
        return (Times(
            start: next, end: end, startDate: inv.allDay ? InviteZones.wall(next, in: "UTC").isoDate : nil,
            endDate: inv.allDay ? InviteZones.wall(end, in: "UTC").isoDate : nil), false)
    }

    // MARK: Merge

    private static func ownResponse(_ inv: ParsedInvite, answer: InviteAnswer?, isOrganizer: Bool) -> InviteResponse {
        let carried: InviteResponse = isOrganizer ? .accepted : inv.attendees.first(where: \.isYou)?.response ?? .needsAction
        if let answer, !(carried != .needsAction && (inv.dtstamp ?? 0) > answer.respondedAt) { return answer.response.response }
        return carried
    }

    static func merge(
        _ invite: ParsedInvite, messageId: Int, versions: [InviteVersion], answer: InviteAnswer?, env: InviteMergeEnvironment
    ) -> MergedInvite {
        let own = Set(env.ownAddresses.map { $0.lowercased() })
        let isOrganizer = invite.organizer.map { own.contains($0.address.lowercased()) } ?? false
        let yours = ownResponse(invite, answer: answer, isOrganizer: isOrganizer)

        func finish(_ state: InviteState, changes: [InviteChange] = [], newer: Int? = nil, times: Times? = nil) -> MergedInvite {
            let t = times ?? Times(start: invite.start, end: invite.end, startDate: invite.startDate, endDate: invite.endDate)
            let current = state == .new || state == .updated
            let answerable = current && invite.method == .request && invite.invitedAs != nil && !isOrganizer && invite.organizer != nil
            return MergedInvite(
                invite: invite, state: state, yourResponse: yours, changes: changes, newerMessageId: newer, start: t.start, end: t.end,
                startDate: t.startDate, endDate: t.endDate, canAnswer: answerable)
        }

        switch invite.method {
        case .reply: return finish(.reply)
        case .counter, .declineCounter, .refresh, .add: return finish(.counter)
        case .cancel: return finish(.cancelled)
        case .request, .publish: break
        }

        let others = versions.filter { versioned.contains($0.invite.method) && $0.messageId != messageId }
        var newest = (messageId: messageId, invite: invite)
        for v in others where compare(v.invite, newest.invite) > 0 { newest = (v.messageId, v.invite) }
        if newest.messageId != messageId {
            return newest.invite.method == .cancel ? finish(.cancelled) : finish(.superseded, newer: newest.messageId)
        }

        let (times, ended) = effectiveTimes(invite, now: env.now, zone: env.zone)
        let over = invite.allDay ? times.end <= allDayToday(now: env.now, zone: env.zone) : times.end < env.now
        if ended || over { return finish(.past, times: times) }

        let earlier = others.filter { $0.invite.method != .cancel && compare($0.invite, invite) < 0 }
        if let previous = earlier.max(by: { compare($0.invite, $1.invite) < 0 }) {
            let changes = diff(previous.invite, invite, zone: env.zone, now: env.now)
            if invite.sequence > previous.invite.sequence || !changes.isEmpty { return finish(.updated, changes: changes, times: times) }
        }
        return finish(.new, times: times)
    }
}

extension Wall {
    var isoDate: String { String(format: "%04d-%02d-%02d", year, month, day) }
}

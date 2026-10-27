import FlintModel
import Foundation

/// iTIP METHOD values the card recognises (RFC 5546). REQUEST is a new or updated invite; REPLY is a guest answering one.
enum InviteMethod: String, Codable, Sendable {
    case request = "REQUEST", cancel = "CANCEL", reply = "REPLY", publish = "PUBLISH"
    case counter = "COUNTER", declineCounter = "DECLINECOUNTER", refresh = "REFRESH", add = "ADD"
}

/// A guest's answer (PARTSTAT folded to four values; DELEGATED and the rest count as needs-action).
enum InviteResponse: String, Codable, Sendable {
    case accepted, tentative, declined, needsAction
}

/// What the person can send back. Needs-action is a state, never an answer.
enum RSVPAnswer: String, Codable, CaseIterable, Sendable {
    case accepted, tentative, declined

    var response: InviteResponse {
        switch self {
        case .accepted: .accepted
        case .tentative: .tentative
        case .declined: .declined
        }
    }

    var partstat: String {
        switch self {
        case .accepted: "ACCEPTED"
        case .tentative: "TENTATIVE"
        case .declined: "DECLINED"
        }
    }
}

enum InviteRole: String, Codable, Sendable { case chair, required, optional, nonParticipant }

struct InviteAttendee: Codable, Hashable, Sendable {
    var name: String
    /// Lower case.
    var address: String
    var response: InviteResponse
    var role: InviteRole
    var rsvp: Bool
    /// One of the person's own addresses (account email or alias).
    var isYou: Bool
}

enum ConferenceKind: String, Codable, Sendable { case meet, zoom, teams, webex, other }

struct InviteConference: Codable, Hashable, Sendable {
    var kind: ConferenceKind
    var url: String
    var label: String
    var code: String?
    var phone: String?
}

struct InviteRecurrence: Codable, Hashable, Sendable {
    var summary: String
    var rrule: String
    var hasExceptions: Bool
    var excluded: [EpochMs] = []
    var added: [EpochMs] = []
}

enum InviteSource: String, Codable, Sendable { case google, outlook, apple, zoom, other }

struct InviteReplyInfo: Codable, Hashable, Sendable {
    var from: Address
    var response: InviteResponse
    var comment: String?
}

/// One calendar invitation as the sender wrote it. Everything the card needs that does not depend on other messages.
struct ParsedInvite: Codable, Hashable, Sendable {
    var uid: String
    var method: InviteMethod
    var sequence: Int
    /// As the sender wrote it, normalised to UTC for timed values ("20261103T230000Z") or a date ("20261103").
    var recurrenceId: String?
    var title: String
    var description: String?
    /// Timed events: epoch ms. All-day events: epoch ms of 00:00 UTC on `startDate`.
    var start: EpochMs
    var end: EpochMs
    var allDay: Bool
    /// All-day only. `endDate` is the day after the last day (iCalendar's exclusive DTEND).
    var startDate: String?
    var endDate: String?
    /// IANA zone the organizer set; "UTC" for Z times, nil when floating or all-day.
    var timeZone: String?
    var recurrence: InviteRecurrence?
    var location: String?
    var url: String?
    var conference: InviteConference?
    var organizer: Address?
    var attendees: [InviteAttendee]
    var invitedAs: InvitedAs?
    var dtstamp: EpochMs?
    var source: InviteSource
    var reply: InviteReplyInfo?

    struct InvitedAs: Codable, Hashable, Sendable {
        var address: String
        var role: InviteRole
        var rsvp: Bool
    }

    /// The same event across versions: account, UID and the occurrence it names.
    func eventKey(account: AccountID) -> String { "\(account)|\(uid)|\(recurrenceId ?? "")" }
}

/// What the card shows. Worked out at read time, never stored.
enum InviteState: String, Codable, Sendable {
    case new, updated, cancelled, past, superseded, reply, counter
}

struct InviteChange: Hashable, Sendable {
    enum Field: String, Sendable { case time, location, title, guests, description, recurrence, conference }
    var field: Field
    var before: String?
    var after: String?
}

/// A parsed invite plus what the other messages and the person's own answers say about it.
struct MergedInvite: Hashable, Sendable {
    var invite: ParsedInvite
    var state: InviteState
    var yourResponse: InviteResponse
    var changes: [InviteChange]
    /// Row id of the newest message about the same event when this one is superseded.
    var newerMessageId: Int?
    /// Effective times: for a series whose first occurrence has passed, the next one.
    var start: EpochMs
    var end: EpochMs
    var startDate: String?
    var endDate: String?
    /// The person can answer: a REQUEST that is current, addressed to them, with an organizer to reply to.
    var canAnswer: Bool
}

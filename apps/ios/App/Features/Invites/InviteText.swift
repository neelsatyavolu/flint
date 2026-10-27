import Foundation

/// Words on the invite card, from the Invites string catalog.
enum InviteText {
    static func heading(_ merged: MergedInvite) -> String {
        switch merged.state {
        case .updated: String(localized: "Updated invitation", table: "Invites")
        case .cancelled: String(localized: "Cancelled", table: "Invites")
        case .past: String(localized: "Past event", table: "Invites")
        case .superseded: String(localized: "Earlier version", table: "Invites")
        case .reply: String(localized: "Reply", table: "Invites")
        case .counter: String(localized: "Calendar message", table: "Invites")
        case .new: merged.invite.method == .publish ? String(localized: "Event", table: "Invites") : String(localized: "Invitation", table: "Invites")
        }
    }

    static func response(_ response: InviteResponse) -> String {
        switch response {
        case .accepted: String(localized: "Going", table: "Invites")
        case .tentative: String(localized: "Maybe", table: "Invites")
        case .declined: String(localized: "Declined", table: "Invites")
        case .needsAction: String(localized: "Awaiting", table: "Invites")
        }
    }

    static func button(_ answer: RSVPAnswer) -> String {
        switch answer {
        case .accepted: String(localized: "Yes", table: "Invites")
        case .tentative: String(localized: "Maybe", table: "Invites")
        case .declined: String(localized: "No", table: "Invites")
        }
    }

    static func spoken(_ answer: RSVPAnswer) -> String {
        switch answer {
        case .accepted: String(localized: "Going", table: "Invites")
        case .tentative: String(localized: "Maybe going", table: "Invites")
        case .declined: String(localized: "Not going", table: "Invites")
        }
    }

    /// What a guest said, to follow their name: "accepted your invitation".
    static func replyPhrase(_ response: InviteResponse) -> String {
        switch response {
        case .accepted: String(localized: "accepted your invitation", table: "Invites")
        case .declined: String(localized: "declined your invitation", table: "Invites")
        case .tentative: String(localized: "said maybe to your invitation", table: "Invites")
        case .needsAction: String(localized: "has not answered your invitation", table: "Invites")
        }
    }

    static func changeLabel(_ field: InviteChange.Field) -> String {
        switch field {
        case .time: String(localized: "Time", table: "Invites")
        case .location: String(localized: "Where", table: "Invites")
        case .title: String(localized: "Title", table: "Invites")
        case .guests: String(localized: "Guests", table: "Invites")
        case .description: String(localized: "Details", table: "Invites")
        case .recurrence: String(localized: "Repeats", table: "Invites")
        case .conference: String(localized: "Video call", table: "Invites")
        }
    }

    /// "6 guests: 2 going, 1 maybe, 1 declined, 2 awaiting"
    static func guestSummary(_ attendees: [InviteAttendee]) -> String {
        let count = attendees.count
        let head = count == 1 ? String(localized: "1 guest", table: "Invites") : String(localized: "\(count) guests", table: "Invites")
        let order: [InviteResponse] = [.accepted, .tentative, .declined, .needsAction]
        let parts = order.compactMap { r -> String? in
            let n = attendees.filter { $0.response == r }.count
            return n == 0 ? nil : "\(n) \(response(r).lowercased())"
        }
        return parts.isEmpty ? head : head + ": " + parts.joined(separator: ", ")
    }

    static func none() -> String { String(localized: "none", table: "Invites") }
}

import SwiftUI

/// The guest count line, with a toggle that lists up to a dozen guests and their answers.
struct InviteGuestsView: View {
    let attendees: [InviteAttendee]
    let messageId: Int
    @State private var open = false

    private var ordered: [InviteAttendee] {
        attendees.sorted { ($0.role == .chair ? 0 : 1, $0.isYou ? 0 : 1) < ($1.role == .chair ? 0 : 1, $1.isYou ? 0 : 1) }
    }

    var body: some View {
        if !attendees.isEmpty {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                Button { open.toggle() } label: {
                    HStack(spacing: FlintMetrics.Space.s2) {
                        FlintIconView(icon: open ? .chevronDown : .chevronRight, size: 14, color: FlintColor.fg3)
                        Text(InviteText.guestSummary(attendees)).flintText(.body, color: FlintColor.fg2)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: FlintMetrics.Size.touch)
                    .contentShape(Rectangle())
                }
                .buttonStyle(FlintPressStyle())
                .accessibilityIdentifier("invite.guests.\(messageId)")
                .accessibilityValue(open ? String(localized: "Expanded", table: "Invites") : String(localized: "Collapsed", table: "Invites"))
                if open {
                    ForEach(ordered.prefix(12), id: \.address) { guest in
                        HStack(alignment: .firstTextBaseline) {
                            Text(name(guest)).flintText(.body).lineLimit(2)
                            Spacer(minLength: FlintMetrics.Space.s2)
                            Text(InviteText.response(guest.response)).flintText(.data, color: FlintColor.fg3)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    if attendees.count > 12 {
                        Text(String(localized: "and \(attendees.count - 12) more", table: "Invites")).flintText(.data, color: FlintColor.fg3)
                    }
                }
            }
        }
    }

    private func name(_ guest: InviteAttendee) -> String {
        var text = guest.isYou ? String(localized: "You", table: "Invites") : guest.name.isEmpty ? guest.address : guest.name
        if guest.role == .chair { text += " · " + String(localized: "Organizer", table: "Invites") }
        if guest.role == .optional { text += " · " + String(localized: "Optional", table: "Invites") }
        return text
    }
}

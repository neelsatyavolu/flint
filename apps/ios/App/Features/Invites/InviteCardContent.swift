import FlintModel
import SwiftUI

/// What the invite card draws, with no access to the app: the merged invite, its times and the model's sending and calendar
/// state. `InviteCardView` loads the data; tests render this directly.
struct InviteCardContent: View {
    let messageId: Int
    let merged: MergedInvite
    let times: InviteCardModel.Times
    @Bindable var model: InviteCardModel
    let onAnswer: (RSVPAnswer) -> Void
    let onAddToCalendar: () -> Void
    let onJoin: (URL) -> Void

    var body: some View {
        card(merged, times)
    }

    private func card(_ merged: MergedInvite, _ times: InviteCardModel.Times) -> some View {
        let invite = merged.invite
        let cancelled = merged.state == .cancelled
        return VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
            header(merged)
            Text(invite.title).flintText(.title).strikethrough(cancelled).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            notices(merged, invite)
            changes(merged)
            facts(merged, times, strike: cancelled)
            actions(merged)
            if let text = invite.description, merged.state == .new || merged.state == .updated {
                Text(text).flintText(.body, color: FlintColor.fg2).lineLimit(6).textSelection(.enabled)
            }
            if merged.state != .reply, merged.state != .counter, !cancelled { InviteGuestsView(attendees: invite.attendees, messageId: messageId) }
            answerSection(merged)
        }
        .padding(FlintMetrics.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FlintColor.plane2, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
        .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(cancelled ? FlintColor.danger.opacity(0.6) : FlintColor.line, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(InviteText.heading(merged) + ": " + invite.title)
        .accessibilityIdentifier("invite.card.\(messageId)")
    }

    private func header(_ merged: MergedInvite) -> some View {
        HStack(spacing: FlintMetrics.Space.s2) {
            FlintIconView(icon: .calendar, size: 14, color: merged.state == .cancelled ? FlintColor.danger : FlintColor.fg3)
            Text(InviteText.heading(merged)).flintText(.label, color: merged.state == .cancelled ? FlintColor.danger : FlintColor.fg3)
                .accessibilityIdentifier("invite.heading.\(messageId)")
        }
    }

    @ViewBuilder
    private func notices(_ merged: MergedInvite, _ invite: ParsedInvite) -> some View {
        switch merged.state {
        case .cancelled: notice(String(localized: "The organizer cancelled this event.", table: "Invites"), id: "cancelled")
        case .past: notice(String(localized: "This event has ended.", table: "Invites"), id: "past")
        case .superseded: notice(String(localized: "A newer version of this invitation is in your mail.", table: "Invites"), id: "superseded")
        case .counter: notice(String(localized: "This is a calendar message Flint can't answer.", table: "Invites"), id: "counter")
        case .reply:
            if let reply = invite.reply {
                notice(FlintFormat.displayName(reply.from) + " " + InviteText.replyPhrase(reply.response), id: "reply", strong: true)
                if let comment = reply.comment { Text(comment).flintText(.body, color: FlintColor.fg2) }
            }
        case .new, .updated: EmptyView()
        }
    }

    private func notice(_ text: String, id: String, strong: Bool = false) -> some View {
        Text(text).flintText(strong ? .bodyStrong : .body, color: strong ? FlintColor.fg : FlintColor.fg2)
            .accessibilityIdentifier("invite.notice.\(id).\(messageId)")
    }

    @ViewBuilder
    private func changes(_ merged: MergedInvite) -> some View {
        if !merged.changes.isEmpty {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s1) {
                Text(String(localized: "What changed", table: "Invites")).flintText(.label, color: FlintColor.fg3)
                ForEach(merged.changes, id: \.field) { change in
                    (Text(InviteText.changeLabel(change.field) + ": ").foregroundStyle(FlintColor.fg3)
                        + Text(change.before ?? InviteText.none()).strikethrough().foregroundStyle(FlintColor.fg3)
                        + Text("  →  ").foregroundStyle(FlintColor.fg3)
                        + Text(change.after ?? InviteText.none()).bold())
                        .flintText(.body)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(InviteText.changeLabel(change.field)): \(change.before ?? InviteText.none()), now \(change.after ?? InviteText.none())")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("invite.changes.\(messageId)")
        }
    }

    private func facts(_ merged: MergedInvite, _ times: InviteCardModel.Times, strike: Bool) -> some View {
        let invite = merged.invite
        return VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
            InviteFactRow(label: String(localized: "When", table: "Invites"), strike: strike) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(times.when + (times.duration.map { " · " + $0 } ?? "")).flintText(.body)
                    if let organizer = times.organizer {
                        Text(organizer + " " + String(localized: "for the organizer", table: "Invites")).flintText(.data, color: FlintColor.fg3)
                    }
                }
                .accessibilityIdentifier("invite.when.\(messageId)")
            }
            if let recurrence = invite.recurrence {
                InviteFactRow(label: String(localized: "Repeats", table: "Invites"), strike: strike) {
                    Text(recurrence.summary + (recurrence.hasExceptions ? " · " + String(localized: "some dates differ", table: "Invites") : "")).flintText(.body)
                }
            }
            if let location = invite.location {
                InviteFactRow(label: String(localized: "Where", table: "Invites"), strike: strike) {
                    Text(location).flintText(.body).textSelection(.enabled).accessibilityIdentifier("invite.where.\(messageId)")
                }
            }
            if let call = invite.conference {
                InviteFactRow(label: String(localized: "Call", table: "Invites"), strike: strike) {
                    Text(call.label + (call.code.map { " · " + String(localized: "ID", table: "Invites") + " " + $0 } ?? "")).flintText(.body)
                }
            }
            if let organizer = invite.organizer, merged.state != .reply {
                InviteFactRow(label: String(localized: "From", table: "Invites"), strike: false) {
                    Text(FlintFormat.displayName(organizer)).flintText(.body).accessibilityIdentifier("invite.organizer.\(messageId)")
                }
            }
        }
    }

    // MARK: Actions

    private var isCurrent: (MergedInvite) -> Bool { { $0.state == .new || $0.state == .updated } }

    @ViewBuilder
    private func actions(_ merged: MergedInvite) -> some View {
        if isCurrent(merged) {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                if let call = merged.invite.conference, let url = URL(string: call.url) {
                    Button { onJoin(url) } label: {
                        Text(String(localized: "Join", table: "Invites") + " " + call.label).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(FlintButtonStyle(kind: .ghost))
                    .accessibilityIdentifier("invite.join.\(messageId)")
                }
                calendarButton
            }
        }
    }

    private var calendarButton: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s1) {
            Button { onAddToCalendar() } label: {
                HStack(spacing: FlintMetrics.Space.s2) {
                    if model.calendar == .added { FlintIconView(icon: .check, size: 14, color: FlintColor.ok) }
                    Text(calendarLabel).frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(FlintButtonStyle(kind: .ghost))
            .disabled(model.calendar == .added || model.calendar == .adding)
            .accessibilityIdentifier("invite.addToCalendar.\(messageId)")
            if case .failed(let failure) = model.calendar {
                Text(failure == .denied
                     ? String(localized: "Calendar access is off. Allow Flint to add events in Settings.", table: "Invites")
                     : String(localized: "Couldn't add the event. Try again.", table: "Invites"))
                    .flintText(.data, color: FlintColor.danger)
                    .accessibilityIdentifier("invite.calendarError.\(messageId)")
            }
        }
    }

    private var calendarLabel: String {
        switch model.calendar {
        case .added: String(localized: "Added to Calendar", table: "Invites")
        case .adding: String(localized: "Adding", table: "Invites")
        default: String(localized: "Add to Calendar", table: "Invites")
        }
    }

    @ViewBuilder
    private func answerSection(_ merged: MergedInvite) -> some View {
        if merged.canAnswer {
            InviteAnswerBar(merged: merged, messageId: messageId, model: model, onAnswer: onAnswer)
        } else if merged.state == .past, merged.yourResponse != .needsAction {
            Text(String(localized: "You answered", table: "Invites") + ": " + InviteText.response(merged.yourResponse))
                .flintText(.data, color: FlintColor.fg3)
                .accessibilityIdentifier("invite.status.\(messageId)")
        }
    }
}

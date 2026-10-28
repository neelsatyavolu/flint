import SwiftUI

/// Yes, Maybe and No, with an optional note. Sends the answer as a reply mail to the organizer.
struct InviteAnswerBar: View {
    let merged: MergedInvite
    let messageId: Int
    @Bindable var model: InviteCardModel
    let onAnswer: (RSVPAnswer) -> Void
    @State private var noteOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
            Text(prompt).flintText(.label, color: FlintColor.fg3)
                .accessibilityIdentifier("invite.status.\(messageId)")
            HStack(spacing: FlintMetrics.Space.s2) {
                ForEach(RSVPAnswer.allCases, id: \.self) { answer in button(answer) }
            }
            .accessibilityElement(children: .contain)
            Button { noteOpen.toggle() } label: {
                HStack(spacing: FlintMetrics.Space.s2) {
                    FlintIconView(icon: noteOpen ? .chevronDown : .chevronRight, size: 14, color: FlintColor.fg3)
                    Text(String(localized: "Add a note", table: "Invites")).flintText(.body, color: FlintColor.fg2)
                }
                .frame(minHeight: FlintMetrics.Size.touch, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(FlintPressStyle())
            .accessibilityIdentifier("invite.noteToggle.\(messageId)")
            if noteOpen {
                TextField(String(localized: "Sent with your answer", table: "Invites"), text: $model.note, axis: .vertical)
                    .lineLimit(2...4)
                    .flintText(.body)
                    .padding(FlintMetrics.Space.s3)
                    .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(FlintColor.lineStrong, lineWidth: 1))
                    .accessibilityLabel(String(localized: "Note to the organizer", table: "Invites"))
                    .accessibilityIdentifier("invite.note.\(messageId)")
            }
        }
    }

    private var prompt: String {
        merged.yourResponse == .needsAction
            ? String(localized: "Going?", table: "Invites")
            : String(localized: "You", table: "Invites") + ": " + InviteText.response(merged.yourResponse)
    }

    private func button(_ answer: RSVPAnswer) -> some View {
        let chosen = merged.yourResponse == answer.response
        let busy = model.sending == answer
        return Button { onAnswer(answer) } label: {
            Text(busy ? String(localized: "Sending", table: "Invites") : InviteText.button(answer)).frame(maxWidth: .infinity)
        }
        .buttonStyle(FlintButtonStyle(kind: chosen ? .primary : .ghost))
        .disabled(model.sending != nil)
        .accessibilityLabel(InviteText.spoken(answer))
        .accessibilityAddTraits(chosen ? .isSelected : [])
        .accessibilityIdentifier("invite.answer.\(answer.rawValue).\(messageId)")
    }
}

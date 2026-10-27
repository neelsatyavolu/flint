import SwiftUI

/// Last step: skippable choices, then the inbox. The notifications switch asks for permission when Go to inbox is tapped.
struct ChoicesStep: View {
    @Bindable var model: OnboardingModel
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s6) {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                FlintIconView(icon: .check, size: 28, color: FlintColor.ok)
                Text("Account added", tableName: "Onboarding")
                    .flintText(.compose)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("onboarding.choices.title")
                if let account = model.addedAccount {
                    Text(account.email).flintText(.data, color: FlintColor.fg3).accessibilityIdentifier("onboarding.choices.account")
                }
                Text("Your mail will start to appear in a moment, newest first.", tableName: "Onboarding")
                    .flintText(.message, color: FlintColor.fg3)
            }
            VStack(spacing: 0) {
                OnboardingToggleRow(
                    title: String(localized: "Notifications", table: "Onboarding"),
                    detail: String(localized: "New mail from people and verification codes. iOS asks for permission when you continue.", table: "Onboarding"),
                    isOn: $model.notificationsWanted, identifier: "onboarding.notifications")
                FlintHairline()
                OnboardingToggleRow(
                    title: String(localized: "Smart inbox", table: "Onboarding"),
                    detail: String(localized: "People first. Newsletters, receipts and alerts are grouped below.", table: "Onboarding"),
                    isOn: $model.smartInbox, identifier: "onboarding.smartInbox")
            }
            .overlay { RoundedRectangle(cornerRadius: FlintMetrics.Radius.card).stroke(FlintColor.line, lineWidth: 1) }
            .clipShape(RoundedRectangle(cornerRadius: FlintMetrics.Radius.card))
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s1) {
                Text("Signature", tableName: "Onboarding").flintText(.bodyStrong)
                Text("Optional. Added under new mail and replies from this account. You can change it later in Settings.", tableName: "Onboarding")
                    .flintText(.body, color: FlintColor.fg3)
                TextEditor(text: $model.signatureText)
                    .flintText(.body)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, FlintMetrics.Space.s2)
                    .padding(.vertical, FlintMetrics.Space.s1)
                    .frame(minHeight: 88)
                    .background(FlintColor.plane2, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
                    .overlay { RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(FlintColor.line, lineWidth: 1) }
                    .accessibilityLabel(String(localized: "Signature", table: "Onboarding"))
                    .accessibilityIdentifier("onboarding.signature")
            }
            if let error = model.errorText {
                Text(error).flintText(.body, color: FlintColor.danger).accessibilityIdentifier("onboarding.choices.error")
            }
            VStack(spacing: FlintMetrics.Space.s3) {
                Button {
                    Task {
                        if await model.applyChoices() { onDone() }
                    }
                } label: {
                    Text("Go to inbox", tableName: "Onboarding").frame(maxWidth: .infinity)
                }
                .buttonStyle(FlintButtonStyle(kind: .primary))
                .accessibilityIdentifier("onboarding.done")
                Button {
                    model.startAnother()
                } label: {
                    Text("Add another account", tableName: "Onboarding").frame(maxWidth: .infinity)
                }
                .buttonStyle(FlintButtonStyle(kind: .ghost))
                .accessibilityIdentifier("onboarding.another")
            }
        }
    }
}

import SwiftUI

/// Last step: two skippable choices, then the inbox. Notifications are shown but do nothing until wave 4.
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
                    detail: String(localized: "Flint will ask for permission when notifications arrive in a later update.", table: "Onboarding"),
                    isOn: $model.notificationsWanted, identifier: "onboarding.notifications")
                FlintHairline()
                OnboardingToggleRow(
                    title: String(localized: "Smart inbox", table: "Onboarding"),
                    detail: String(localized: "People first. Newsletters, receipts and alerts are grouped below.", table: "Onboarding"),
                    isOn: $model.smartInbox, identifier: "onboarding.smartInbox")
            }
            .overlay { RoundedRectangle(cornerRadius: FlintMetrics.Radius.card).stroke(FlintColor.line, lineWidth: 1) }
            .clipShape(RoundedRectangle(cornerRadius: FlintMetrics.Radius.card))
            VStack(spacing: FlintMetrics.Space.s3) {
                Button {
                    Task {
                        await model.applyChoices()
                        onDone()
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

import FlintMail
import SwiftUI

/// Email, detected servers, password, test and add.
struct OtherEmailStep: View {
    @Bindable var model: OnboardingModel

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s5) {
            OnboardingField(
                label: String(localized: "Email address", table: "Onboarding"), text: $model.email,
                prompt: String(localized: "you@example.com", table: "Onboarding"), identifier: "onboarding.email",
                keyboard: .emailAddress, contentType: .emailAddress) { Task { await model.detectServers() } }
            if model.isBlocked {
                blockedNotice
            } else {
                details
            }
        }
        .task(id: model.trimmedEmail) {
            guard EmailAddress.isPlausible(model.trimmedEmail) else { return }
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            await model.detectServers()
        }
    }

    // MARK: Proton

    private var blockedNotice: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
            OnboardingNotice(
                tone: .danger,
                text: String(localized: "Proton Mail only works through Proton Bridge, an app that runs on a computer. A phone can't reach it, so this account can't be added here.", table: "Onboarding"),
                identifier: "onboarding.proton")
            Text("Use Flint on your Mac for Proton Mail.", tableName: "Onboarding").flintText(.body, color: FlintColor.fg3)
        }
    }

    // MARK: Servers, password, actions

    @ViewBuilder private var details: some View {
        if model.advice == .microsoftSignInUnsupported {
            OnboardingNotice(
                tone: .warn,
                text: String(localized: "Microsoft sign-in isn't supported yet. If your account allows app passwords, you can still add it with one.", table: "Onboarding"),
                identifier: "onboarding.microsoft")
        }
        if model.detection != .idle {
            serverSummary
            if model.editingServers { ServerFieldsView(form: $model.form) }
        }
        OnboardingField(
            label: String(localized: "Name", table: "Onboarding"), text: $model.name,
            prompt: String(localized: "Shown on mail you send", table: "Onboarding"), identifier: "onboarding.name",
            contentType: .name, capitalization: .words)
        passwordSection
        checkResult
        if let text = model.errorText { OnboardingNotice(tone: .danger, text: text, identifier: "onboarding.error") }
        actions
    }

    private var serverSummary: some View {
        HStack(alignment: .firstTextBaseline, spacing: FlintMetrics.Space.s3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(summaryTitle).flintText(.label, color: FlintColor.fg3)
                Text(summaryLine).flintText(.data, color: FlintColor.fg2).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if model.detection != .checking {
                Button(model.editingServers ? String(localized: "Hide", table: "Onboarding") : String(localized: "Edit", table: "Onboarding")) {
                    model.editingServers.toggle()
                }
                .buttonStyle(FlintButtonStyle(kind: .ghost))
                .accessibilityIdentifier("onboarding.server.edit")
            }
        }
        .padding(FlintMetrics.Space.s3)
        .background(FlintColor.plane2, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("onboarding.summary")
    }

    private var summaryTitle: String {
        switch model.detection {
        case .checking: String(localized: "Looking up servers", table: "Onboarding")
        case .notFound: String(localized: "Servers not found", table: "Onboarding")
        default: String(localized: "Servers", table: "Onboarding")
        }
    }

    private var summaryLine: String {
        switch model.detection {
        case .checking: String(localized: "One moment", table: "Onboarding")
        case .notFound: String(localized: "Enter the server details below.", table: "Onboarding")
        default:
            "\(model.form.imapHost):\(model.form.imapPort)  \(model.form.smtpHost):\(model.form.smtpPort)"
        }
    }

    private var passwordSection: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
            OnboardingField(
                label: String(localized: "Password", table: "Onboarding"), text: $model.password, identifier: "onboarding.password",
                secure: true, contentType: .password, submitLabel: .done)
            if model.hint == .appPassword || model.offersGoogleInstead {
                Text("Gmail and iCloud need an app password, not your usual one. Create it in your account's security settings.", tableName: "Onboarding")
                    .flintText(.body, color: FlintColor.fg3)
                    .accessibilityIdentifier("onboarding.passwordHint")
            }
            if model.offersGoogleInstead {
                Button(String(localized: "Sign in with Google instead", table: "Onboarding")) {
                    Task { await model.continueWithGoogle(loginHint: model.trimmedEmail) }
                }
                .buttonStyle(FlintButtonStyle(kind: .ghost))
                .accessibilityIdentifier("onboarding.googleInstead")
            }
        }
    }

    @ViewBuilder private var checkResult: some View {
        if let check = model.check {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                resultLine(title: String(localized: "Incoming", table: "Onboarding"), outcome: check.imap, id: "imap")
                resultLine(title: String(localized: "Outgoing", table: "Onboarding"), outcome: check.smtp, id: "smtp")
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("onboarding.check")
        }
    }

    private func resultLine(title: String, outcome: ConnectionOutcome, id: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: FlintMetrics.Space.s3) {
            Text(title).flintText(.label, color: FlintColor.fg3).frame(width: 84, alignment: .leading)
            Text(model.outcomeLine(outcome))
                .flintText(.body, color: outcome == .ok ? FlintColor.ok : (outcome == .skipped ? FlintColor.fg3 : FlintColor.danger))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("onboarding.check.\(id)")
    }

    private var actions: some View {
        VStack(spacing: FlintMetrics.Space.s3) {
            Button {
                Task { await model.addAccount() }
            } label: {
                Text(model.busy == .adding ? String(localized: "Adding", table: "Onboarding") : String(localized: "Add account", table: "Onboarding"))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(FlintButtonStyle(kind: .primary))
            .disabled(!model.canAdd)
            .accessibilityIdentifier("onboarding.add")
            Button {
                Task { await model.testConnection() }
            } label: {
                Text(model.busy == .testing ? String(localized: "Testing", table: "Onboarding") : String(localized: "Test connection", table: "Onboarding"))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(FlintButtonStyle(kind: .ghost))
            .disabled(!model.canTest)
            .accessibilityIdentifier("onboarding.test")
        }
    }
}

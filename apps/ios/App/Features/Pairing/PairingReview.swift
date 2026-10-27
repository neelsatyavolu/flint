import FlintModel
import FlintPairing
import SwiftUI

private func pl(_ key: String.LocalizationValue) -> String { PairingText.pl(key) }

/// What arrived from the Mac, before anything is added. Google accounts are "Sign in" rows.
struct PairingReviewStep: View {
    @Bindable var model: PairingModel

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    accountsGroup
                    libraryGroup
                    if let error = model.rowError {
                        OnboardingNotice(tone: .danger, text: error, identifier: "pairing.review.error")
                            .padding(.horizontal, FlintMetrics.Space.s4).padding(.top, FlintMetrics.Space.s4)
                    }
                }
                .padding(.bottom, FlintMetrics.Space.s6)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            footer
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s1) {
            Text(pl("From") + " " + model.macName).flintText(.compose).accessibilityIdentifier("pairing.review.title")
            Text(pl("Nothing is added until you press Add to this iPhone.")).flintText(.message, color: FlintColor.fg3)
        }
        .padding(.horizontal, FlintMetrics.Space.s4).padding(.top, FlintMetrics.Space.s5)
    }

    @ViewBuilder private var accountsGroup: some View {
        SettingsGroup(title: pl("Accounts")) {
            ForEach(model.readyRows) { row in
                SettingsRowLayout(icon: .mail, title: row.account.email, detail: readyDetail(row)) {
                    FlintIconView(icon: .check, size: 16, color: FlintColor.ok)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("pairing.account.\(row.id)")
            }
            ForEach(model.pendingRows) { row in PairingPendingRow(model: model, row: row) }
            ForEach(model.conflictingRows) { row in
                SettingsToggleRow(
                    icon: .mail, title: row.account.email, detail: pl("Already on this iPhone. Use the Mac's details?"),
                    isOn: replaceBinding(row.id), identifier: "pairing.replace.\(row.id)")
            }
        }
    }

    @ViewBuilder private var libraryGroup: some View {
        if let plan = model.plan {
            let count = plan.signatures.count + plan.templates.count + plan.rules.count + plan.blockedSenders.count
            if count > 0 || plan.alreadyHere != ImportCounts() {
                SettingsGroup(title: pl("Also on your Mac"), note: pl("Rules and signatures for an account that isn't set up here are skipped.")) {
                    libraryRow(pl("Signatures"), plan.signatures.count, plan.alreadyHere.signatures, "signatures")
                    libraryRow(pl("Templates"), plan.templates.count, plan.alreadyHere.templates, "templates")
                    libraryRow(pl("Rules"), plan.rules.count, plan.alreadyHere.rules, "rules")
                    libraryRow(pl("Blocked senders"), plan.blockedSenders.count, plan.alreadyHere.blockedSenders, "blocked")
                    SettingsToggleRow(title: pl("Add these"), isOn: $model.selection.includeLibrary, identifier: "pairing.library.toggle", disabled: count == 0)
                }
            }
            if plan.hasSettings {
                SettingsGroup(title: pl("Settings")) {
                    SettingsToggleRow(
                        title: pl("Copy settings"), detail: pl("Undo send time, sync window, theme and similar choices. Never passwords or tokens."),
                        isOn: $model.selection.includeSettings, identifier: "pairing.settings.toggle")
                }
            }
        }
    }

    private func libraryRow(_ title: String, _ new: Int, _ already: Int, _ id: String) -> some View {
        SettingsRowLayout(title: title, detail: nil) {
            Text(PairingText.libraryDetail(new: new, already: already)).flintText(.data, color: FlintColor.fg2)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("pairing.library.\(id)")
    }

    private func readyDetail(_ row: PlannedAccount) -> String {
        model.addedRows.contains(row.id) ? pl("Added") : pl("Ready to add")
    }

    private func replaceBinding(_ id: String) -> Binding<Bool> {
        Binding(
            get: { model.selection.replaceAccounts.contains(id) },
            set: { on in if on { model.selection.replaceAccounts.insert(id) } else { model.selection.replaceAccounts.remove(id) } })
    }

    private var footer: some View {
        VStack(spacing: FlintMetrics.Space.s2) {
            FlintHairline()
            Button(pl("Add to this iPhone")) { Task { await model.confirm() } }
                .buttonStyle(FlintButtonStyle(kind: .primary)).frame(maxWidth: .infinity)
                .disabled(model.busyRow != nil)
                .padding(.horizontal, FlintMetrics.Space.s4)
                .accessibilityIdentifier("pairing.import")
            Button(pl("Cancel")) { model.cancel() }
                .buttonStyle(FlintButtonStyle(kind: .ghost)).frame(maxWidth: .infinity)
                .padding(.horizontal, FlintMetrics.Space.s4)
                .accessibilityIdentifier("pairing.review.cancel")
        }
        .padding(.bottom, FlintMetrics.Space.s3)
        .background(FlintColor.plane1)
    }
}

/// An account that arrived without a login: Google (Sign in) or an app password the Mac was told not to send (Add password).
private struct PairingPendingRow: View {
    let model: PairingModel
    let row: PlannedAccount
    @State private var typing = false
    @State private var password = ""

    private var working: Bool { model.busyRow == row.id }

    var body: some View {
        VStack(spacing: 0) {
            SettingsRowLayout(icon: .mail, title: row.account.email, detail: detail) {
                if working {
                    ProgressView().controlSize(.small).tint(FlintColor.fg3)
                } else {
                    Button(buttonTitle, action: tap).buttonStyle(FlintButtonStyle(kind: .ghost))
                        .disabled(model.busyRow != nil)
                        .accessibilityIdentifier("pairing.signin.\(row.id)")
                }
            }
            if typing {
                VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
                    OnboardingField(
                        label: pl("Password"), text: $password, prompt: pl("App password"), identifier: "pairing.password.\(row.id)", secure: true,
                        contentType: .password, submitLabel: .go) { submit() }
                    Button(pl("Add account"), action: submit)
                        .buttonStyle(FlintButtonStyle(kind: .secondary)).disabled(password.isEmpty)
                        .accessibilityIdentifier("pairing.password.add.\(row.id)")
                }
                .padding(FlintMetrics.Space.s4)
            }
        }
    }

    private var detail: String {
        row.credential == .needsGoogleSignIn ? pl("Needs Google sign-in") : pl("Needs a password")
    }

    private var buttonTitle: String { row.credential == .needsGoogleSignIn ? pl("Sign in") : pl("Add password") }

    private func tap() {
        if row.credential == .needsGoogleSignIn { Task { await model.signIn(row) } } else { typing.toggle() }
    }

    private func submit() {
        guard !password.isEmpty else { return }
        let value = password
        password = ""
        typing = false
        Task { await model.addPassword(row, password: value) }
    }
}

struct PairingDoneStep: View {
    let model: PairingModel
    let done: () -> Void

    var body: some View {
        PairingColumn {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                FlintIconView(icon: .check, size: 28, color: FlintColor.ok)
                Text(pl("Set up")).flintText(.compose).accessibilityAddTraits(.isHeader)
                Text(summary).flintText(.message).accessibilityIdentifier("pairing.done.summary")
            }
            ForEach(Array(notes.enumerated()), id: \.offset) { _, note in
                OnboardingNotice(tone: .warn, text: note, identifier: "pairing.done.note")
            }
            Button(pl("Done"), action: done)
                .buttonStyle(FlintButtonStyle(kind: .primary)).frame(maxWidth: .infinity)
                .accessibilityIdentifier("pairing.done")
        }
    }

    private var summary: String {
        var counts = model.result?.added ?? ImportCounts()
        counts.accounts += model.addedRows.count
        return PairingText.added(counts)
    }

    private var notes: [String] {
        let google = model.pendingRows.filter { $0.credential == .needsGoogleSignIn }.count
        let password = model.pendingRows.filter { $0.credential == .needsPassword }.count
        var out = PairingText.stillNeeds(google: google, password: password)
        let failed = model.result?.failedAccounts ?? []
        if !failed.isEmpty { out.append(pl("Couldn't sign in with the password from your Mac:") + " " + failed.joined(separator: ", ")) }
        if let skipped = model.result?.skippedNoAccount, skipped > 0 {
            out.append("\(skipped) " + pl("signatures or rules were skipped because their account isn't set up here."))
        }
        return out
    }
}

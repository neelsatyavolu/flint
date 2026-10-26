import FlintModel
import SwiftUI

/// One account: name, unified inbox, aliases, color, servers, sign in again, remove.
struct AccountDetailView: View {
    let accountId: AccountID
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var didLoadName = false
    @State private var confirmRemove = false
    @State private var reauthPassword = ""
    @State private var showsPassword = false
    @State private var busy = false

    var body: some View {
        if let account = model.account(accountId) {
            page(account)
        } else {
            SettingsPage(title: sl("Account"), identifier: "account") {
                FlintEmptyState(icon: .user, title: sl("This account was removed"), identifier: "settings.account.gone")
            }
        }
    }

    private func page(_ account: Account) -> some View {
        let status = AccountStatus.describe(sync: model.syncStatus(for: account.id), enabled: account.enabled)
        return SettingsPage(title: account.email, identifier: "account") {
            Text(status.text).flintText(.data, color: AccountStatusColor.color(status.tone))
                .padding(.horizontal, FlintMetrics.Space.s4)
                .padding(.top, FlintMetrics.Space.s3)
                .accessibilityIdentifier("settings.account.status")
            SettingsField(label: sl("Name"), text: $name, prompt: sl("Your name"), identifier: "settings.account.name")
                .onSubmit { commitName(account) }
                .submitLabel(.done)
            SettingsToggleRow(
                title: sl("Show in unified inbox"),
                detail: account.showInUnified
                    ? sl("Mail from this account appears in All accounts and the badge.")
                    : sl("Mail from this account is left out of All accounts and the badge. Open the account from the sidebar to read it."),
                isOn: Binding(get: { account.showInUnified }, set: { value in patch(AccountPatch(showInUnified: value)) }),
                identifier: "settings.account.unified")
                .padding(.top, FlintMetrics.Space.s3)
            SettingsGroup(title: sl("Aliases"), note: sl("Addresses you can send from with this account.")) {
                AliasEditor(own: account.email, aliases: account.aliases) { patch(AccountPatch(aliases: $0)) }
            }
            SettingsGroup(title: sl("Color")) {
                ColorSwatches(current: account.color, label: String(format: sl("Color for %@"), account.email)) { patch(AccountPatch(color: $0)) }
            }
            SettingsGroup(title: sl("Servers")) {
                Text(servers(account)).flintText(.data, color: FlintColor.fg2)
                    .padding(FlintMetrics.Space.s4)
                    .accessibilityIdentifier("settings.account.servers")
            }
            reauthSection(account, needsSignIn: status.needsSignIn)
            SettingsButton(title: sl("Remove account"), kind: .danger, disabled: busy, identifier: "settings.account.remove") { confirmRemove = true }
                .padding(.horizontal, FlintMetrics.Space.s4)
                .padding(.top, FlintMetrics.Space.s6)
        }
        .onAppear {
            guard !didLoadName else { return }
            name = account.name
            didLoadName = true
        }
        .onDisappear { commitName(account) }
        .confirmationDialog(sl("Remove this account?"), isPresented: $confirmRemove, titleVisibility: .visible) {
            Button(sl("Remove"), role: .destructive) { remove(account) }
            Button(sl("Cancel"), role: .cancel) {}
        } message: {
            Text(String(format: sl("%@ and its mail stored on this iPhone will be removed from Flint. Your mail stays with your provider."), account.email))
        }
    }

    @ViewBuilder private func reauthSection(_ account: Account, needsSignIn: Bool) -> some View {
        SettingsGroup(title: sl("Sign in"), note: needsSignIn ? sl("Flint can't sign in to this account. Sign in again to resume syncing.") : nil) {
            if account.authKind == .oauthGoogle {
                SettingsButton(title: sl("Sign in with Google again"), kind: needsSignIn ? .primary : .ghost, disabled: busy, identifier: "settings.account.reauth") {
                    reauthGoogle(account)
                }
                .padding(FlintMetrics.Space.s4)
            } else if showsPassword {
                passwordForm(account)
            } else {
                SettingsButton(title: sl("Sign in again"), kind: needsSignIn ? .primary : .ghost, disabled: busy, identifier: "settings.account.reauth") {
                    showsPassword = true
                }
                .padding(FlintMetrics.Space.s4)
            }
        }
    }

    private func passwordForm(_ account: Account) -> some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
            Text("Password", tableName: "Settings").flintText(.label)
            SecureField("", text: $reauthPassword, prompt: Text(sl("Password or app password")).foregroundStyle(FlintColor.fg4))
                .flintText(.body)
                .textContentType(.password)
                .padding(.horizontal, FlintMetrics.Space.s3)
                .frame(minHeight: FlintMetrics.Size.touch)
                .background(FlintColor.plane2, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
                .overlay { RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(FlintColor.line, lineWidth: 1) }
                .accessibilityLabel(sl("Password"))
                .accessibilityIdentifier("settings.account.password")
            SettingsButton(title: sl("Sign in"), kind: .primary, disabled: busy || reauthPassword.isEmpty, identifier: "settings.account.reauth.submit") {
                reauthPassword(account)
            }
        }
        .padding(FlintMetrics.Space.s4)
    }

    private func servers(_ account: Account) -> String {
        let method = account.authKind == .oauthGoogle ? sl("Google sign-in") : sl("Password")
        let server = account.server
        return "IMAP \(server.imapHost):\(server.imapPort)\nSMTP \(server.smtpHost):\(server.smtpPort)\n\(method)"
    }

    // MARK: Actions

    private func commitName(_ account: Account) {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard didLoadName, model.account(accountId) != nil, !trimmed.isEmpty, trimmed != account.name else { return }
        patch(AccountPatch(name: trimmed))
    }

    private func patch(_ patch: AccountPatch) {
        Task {
            do { _ = try await model.updateAccount(id: accountId, patch) } catch { model.report(error) }
        }
    }

    private func reauthGoogle(_ account: Account) {
        run {
            _ = try await model.addGoogleAccount(loginHint: account.email)
            model.toasts.show(sl("Signed in"))
        }
    }

    private func reauthPassword(_ account: Account) {
        let input = AddAccountInput(email: account.email, name: account.name, password: reauthPassword, provider: account.provider, server: account.server)
        run {
            _ = try await model.addAccount(input)
            reauthPassword = ""
            showsPassword = false
            model.toasts.show(sl("Signed in"))
        }
    }

    private func remove(_ account: Account) {
        run {
            try await model.removeAccount(id: account.id)
            dismiss()
        }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        busy = true
        Task {
            defer { busy = false }
            do { try await work() } catch { model.report(error) }
        }
    }
}

enum AccountStatusColor {
    static func color(_ tone: AccountStatus.Tone) -> Color {
        switch tone {
        case .ok: FlintColor.ok
        case .warn: FlintColor.warn
        case .error: FlintColor.danger
        case .muted: FlintColor.fg3
        }
    }
}

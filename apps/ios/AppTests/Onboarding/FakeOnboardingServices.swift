@testable import Flint
@testable import FlintMail
import FlintModel
import Foundation

/// Scripted `OnboardingServices` for the onboarding view model tests. Nothing here touches the network or a real account.
@MainActor
final class FakeOnboardingServices: OnboardingServices {
    var autoconfigResult: Result<AutoconfigResult?, FlintError> = .success(nil)
    var adviceResult: ProviderAdvice?
    var checkResult: Result<ConnectionCheck, FlintError> = .success(ConnectionCheck(imap: .ok, smtp: .ok))
    var addResult: Result<Account, FlintError> = .success(FakeOnboardingServices.account)
    var googleResult: Result<Account, FlintError> = .success(FakeOnboardingServices.account)
    var autoconfigDelay: Duration = .zero

    private(set) var autoconfigCalls: [String] = []
    private(set) var testedInputs: [AddAccountInput] = []
    private(set) var addedInputs: [AddAccountInput] = []
    private(set) var googleHints: [String?] = []
    private(set) var smartInboxValues: [Bool] = []

    nonisolated static let server = ServerConfig(
        imapHost: "imap.example.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.example.com", smtpPort: 465, smtpSecure: true,
        username: "maya@example.com")
    nonisolated static let account = Account(
        id: "acc-1", email: "maya@example.com", name: "Maya", provider: .imap, authKind: .password, server: server)

    func autoconfig(email: String) async throws -> AutoconfigResult? {
        autoconfigCalls.append(email)
        if autoconfigDelay > .zero { try? await Task.sleep(for: autoconfigDelay) }
        return try autoconfigResult.get()
    }

    func advice(email: String) async -> ProviderAdvice? { adviceResult }

    func testConnection(_ input: AddAccountInput) async throws -> ConnectionCheck {
        testedInputs.append(input)
        return try checkResult.get()
    }

    func addAccount(_ input: AddAccountInput) async throws -> Account {
        addedInputs.append(input)
        return try addResult.get()
    }

    func addGoogleAccount(loginHint: String?) async throws -> Account {
        googleHints.append(loginHint)
        return try googleResult.get()
    }

    func setSmartInbox(_ enabled: Bool) async { smartInboxValues.append(enabled) }
}

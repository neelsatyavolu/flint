import FlintMail
import FlintModel
import Foundation

/// What onboarding needs from the app. `AppModel` is wrapped (not extended) so tests can pass a fake.
@MainActor
protocol OnboardingServices: Sendable {
    func autoconfig(email: String) async throws -> AutoconfigResult?
    func advice(email: String) async -> ProviderAdvice?
    func testConnection(_ input: AddAccountInput) async throws -> ConnectionCheck
    func addAccount(_ input: AddAccountInput) async throws -> Account
    func addGoogleAccount(loginHint: String?) async throws -> Account
    func setSmartInbox(_ enabled: Bool) async
    /// On: ask the system for permission. Off: switch Flint's alerts off. Defaults to nothing for fakes.
    func setNotifications(_ wanted: Bool) async
    func saveSignature(_ signature: Signature) async throws
}

extension OnboardingServices {
    func setNotifications(_ wanted: Bool) async {}
}

struct AppOnboardingServices: OnboardingServices {
    let model: AppModel

    func autoconfig(email: String) async throws -> AutoconfigResult? { try await model.autoconfig(email: email) }
    func advice(email: String) async -> ProviderAdvice? { await model.autoconfigAdvice(email: email) }
    func testConnection(_ input: AddAccountInput) async throws -> ConnectionCheck { try await model.testConnection(input) }
    func addAccount(_ input: AddAccountInput) async throws -> Account { try await model.addAccount(input) }
    func addGoogleAccount(loginHint: String?) async throws -> Account { try await model.addGoogleAccount(loginHint: loginHint) }

    func saveSignature(_ signature: Signature) async throws { _ = try await model.requireService().saveSignature(signature) }

    func setNotifications(_ wanted: Bool) async { await model.applyNotificationChoice(wanted: wanted) }

    func setSmartInbox(_ enabled: Bool) async {
        await model.updateSettings(patch: .object(["inbox": .object(["focused": .bool(enabled)])]))
    }
}

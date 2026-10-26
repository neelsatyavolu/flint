import FlintMail
import FlintModel
import Foundation
import Observation

/// State and logic for the add-account flow. Views read it and call its async methods; the services are injected.
@MainActor
@Observable
final class OnboardingModel {
    enum Step: Equatable { case welcome, otherEmail, choices }
    enum Detection: Equatable { case idle, checking, found, notFound }
    enum Busy: Equatable { case google, testing, adding }

    // MARK: State

    private(set) var step: Step = .welcome
    private(set) var busy: Busy?
    private(set) var errorText: String?
    private(set) var addedAccount: Account?

    var email = ""
    var name = ""
    var password = ""
    var form = ServerForm() {
        didSet { if form != oldValue { serverEdited = true; check = nil } }
    }
    var editingServers = false
    var smartInbox = true
    var notificationsWanted = true

    private(set) var detection: Detection = .idle
    private(set) var advice: ProviderAdvice?
    private(set) var hint: ServerHint?
    private(set) var check: ConnectionCheck?

    @ObservationIgnored let services: any OnboardingServices
    @ObservationIgnored private var serverEdited = false
    @ObservationIgnored private var lookupToken = 0
    @ObservationIgnored private var lookedUpDomain = ""

    init(services: any OnboardingServices) {
        self.services = services
    }

    // MARK: Derived

    var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }
    var isBlocked: Bool { advice?.blocksSetup ?? false }
    var offersGoogleInstead: Bool { EmailAddress.isGoogleAddress(trimmedEmail) }
    var canTest: Bool { canSubmit && busy == nil }
    var canAdd: Bool { canSubmit && busy == nil }

    private var canSubmit: Bool {
        EmailAddress.isPlausible(trimmedEmail) && !password.isEmpty && form.config != nil && !isBlocked && detection != .checking
    }

    // MARK: Navigation

    func show(_ next: Step) {
        errorText = nil
        step = next
    }

    func back() {
        switch step {
        case .otherEmail: show(.welcome)
        case .welcome, .choices: break
        }
    }

    /// Back to a clean welcome step for another account.
    func startAnother() {
        email = ""
        name = ""
        password = ""
        form = ServerForm()
        serverEdited = false
        editingServers = false
        detection = .idle
        advice = nil
        hint = nil
        check = nil
        addedAccount = nil
        show(.welcome)
    }

    // MARK: Google

    func continueWithGoogle(loginHint: String? = nil) async {
        guard busy == nil else { return }
        busy = .google
        errorText = nil
        defer { busy = nil }
        do {
            addedAccount = try await services.addGoogleAccount(loginHint: loginHint)
            step = .choices
        } catch {
            show(error: error)
        }
    }

    // MARK: Choices

    /// Applies the choices on the last screen. Notifications are a no-op until wave 4 wires the permission request.
    func applyChoices() async {
        await services.setSmartInbox(smartInbox)
    }

    // MARK: Errors

    func show(error: any Error) {
        errorText = FlintErrorText.isSilent(error) ? nil : FlintErrorText.message(for: error)
    }

    func clearError() { errorText = nil }

    // MARK: Internals shared with the email extension

    func setBusy(_ value: Busy?) { busy = value }
    func setDetection(_ value: Detection) { detection = value }
    func setAdvice(_ value: ProviderAdvice?, hint newHint: ServerHint?) {
        advice = value
        hint = newHint
    }
    func setCheck(_ value: ConnectionCheck?) { check = value }
    func complete(with account: Account) {
        addedAccount = account
        step = .choices
    }
    func nextLookupToken() -> Int {
        lookupToken += 1
        return lookupToken
    }
    /// Hand edits belong to one domain: a different domain starts from what is detected again.
    func noteLookup(domain: String) {
        if domain != lookedUpDomain { serverEdited = false }
        lookedUpDomain = domain
    }
    func isCurrent(_ token: Int) -> Bool { token == lookupToken }
    var serverWasEdited: Bool { serverEdited }
    func replaceDetectedForm(_ detected: ServerForm) {
        let edited = serverEdited
        form = detected
        serverEdited = edited
        check = nil
    }
}

@testable import Flint
@testable import FlintMail
import FlintModel
import Foundation
import Testing

@MainActor
@Suite("Onboarding model")
struct OnboardingModelTests {
    private func make(_ configure: (FakeOnboardingServices) -> Void = { _ in }) -> (OnboardingModel, FakeOnboardingServices) {
        let services = FakeOnboardingServices()
        configure(services)
        return (OnboardingModel(services: services), services)
    }

    private func found(_ model: OnboardingModel) async {
        model.email = "maya@example.com"
        await model.detectServers()
    }

    // MARK: Detection

    @Test("detected servers fill the form and the summary shows")
    func detectFound() async {
        let (model, _) = make { $0.autoconfigResult = .success(AutoconfigResult(server: FakeOnboardingServices.server)) }
        await found(model)
        #expect(model.detection == .found)
        #expect(model.form.imapHost == "imap.example.com")
        #expect(model.form.smtpPort == "465")
        #expect(model.editingServers == false)
    }

    @Test("no settings found opens the server fields with the address as username")
    func detectMissing() async {
        let (model, _) = make()
        await found(model)
        #expect(model.detection == .notFound)
        #expect(model.editingServers)
        #expect(model.form.username == "maya@example.com")
    }

    @Test("a lookup error is treated as not found, not shown as a failure")
    func detectError() async {
        let (model, _) = make { $0.autoconfigResult = .failure(FlintError(.network, "down")) }
        await found(model)
        #expect(model.detection == .notFound)
        #expect(model.errorText == nil)
    }

    @Test("an implausible address resets detection and makes no lookup")
    func detectImplausible() async {
        let (model, services) = make()
        model.email = "maya@"
        await model.detectServers()
        #expect(model.detection == .idle)
        #expect(services.autoconfigCalls.isEmpty)
    }

    @Test("Proton Bridge blocks setup")
    func protonBlocks() async {
        let (model, _) = make {
            $0.adviceResult = .needsProtonBridge
            $0.autoconfigResult = .success(AutoconfigResult(server: FakeOnboardingServices.server, hint: .protonBridge))
        }
        await found(model)
        model.password = "secret"
        #expect(model.isBlocked)
        #expect(model.canAdd == false)
        #expect(model.canTest == false)
        await model.addAccount()
        #expect(model.step == .welcome)
    }

    @Test("Microsoft only warns")
    func microsoftWarns() async {
        let (model, _) = make {
            $0.adviceResult = .microsoftSignInUnsupported
            $0.autoconfigResult = .success(AutoconfigResult(server: FakeOnboardingServices.server))
        }
        await found(model)
        model.password = "app-password"
        #expect(model.isBlocked == false)
        #expect(model.canAdd)
    }

    @Test("hand edits survive a second lookup for the same domain but not a new domain")
    func editsAndDomains() async {
        let (model, _) = make { $0.autoconfigResult = .success(AutoconfigResult(server: FakeOnboardingServices.server)) }
        await found(model)
        model.form.imapHost = "mail.custom.test"
        await model.detectServers()
        #expect(model.form.imapHost == "mail.custom.test")
        model.email = "maya@other.org"
        await model.detectServers()
        #expect(model.form.imapHost == "imap.example.com")
    }

    @Test("an older lookup does not overwrite a newer one")
    func staleLookup() async {
        let (model, services) = make {
            $0.autoconfigResult = .success(AutoconfigResult(server: FakeOnboardingServices.server))
            $0.autoconfigDelay = .milliseconds(150)
        }
        model.email = "maya@first.test"
        let slow = Task { await model.detectServers() }
        try? await Task.sleep(for: .milliseconds(30))
        services.autoconfigDelay = .zero
        services.autoconfigResult = .success(AutoconfigResult(server: ServerConfig(
            imapHost: "imap.second.test", imapPort: 993, imapSecure: true, smtpHost: "smtp.second.test", smtpPort: 587, smtpSecure: false, username: "maya@second.test")))
        model.email = "maya@second.test"
        await model.detectServers()
        await slow.value
        #expect(model.form.imapHost == "imap.second.test")
        #expect(model.form.smtpSecure == false)
    }

    // MARK: Test and add

    @Test("test connection stores both outcomes")
    func testStores() async {
        let (model, services) = make {
            $0.autoconfigResult = .success(AutoconfigResult(server: FakeOnboardingServices.server))
            $0.checkResult = .success(ConnectionCheck(imap: .ok, smtp: .failed(FlintError(.network, "Couldn't reach smtp.example.com. Check the server name or your connection."))))
        }
        await found(model)
        model.password = "pw"
        await model.testConnection()
        #expect(services.testedInputs.count == 1)
        #expect(model.check?.imap == .ok)
        let line = model.outcomeLine(model.check?.smtp ?? .skipped)
        #expect(line.hasPrefix("Couldn't reach smtp.example.com"))
        #expect(model.busy == nil)
    }

    @Test("editing a server field clears the old test result")
    func editClearsCheck() async {
        let (model, _) = make { $0.autoconfigResult = .success(AutoconfigResult(server: FakeOnboardingServices.server)) }
        await found(model)
        model.password = "pw"
        await model.testConnection()
        #expect(model.check != nil)
        model.form.smtpPort = "587"
        #expect(model.check == nil)
    }

    @Test("add builds the input, uses the local part as name and moves to choices")
    func addAccount() async {
        let (model, services) = make { $0.autoconfigResult = .success(AutoconfigResult(server: FakeOnboardingServices.server)) }
        await found(model)
        model.password = "pw"
        await model.addAccount()
        #expect(services.addedInputs.first?.name == "maya")
        #expect(services.addedInputs.first?.provider == .imap)
        #expect(services.addedInputs.first?.server?.imapHost == "imap.example.com")
        #expect(model.step == .choices)
        #expect(model.addedAccount?.email == "maya@example.com")
    }

    @Test("a Gmail server sets the gmail provider and a typed name wins")
    func gmailProvider() async {
        let gmail = ServerConfig(imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: "maya@gmail.com")
        let (model, services) = make { $0.autoconfigResult = .success(AutoconfigResult(server: gmail, hint: .appPassword)) }
        model.email = "maya@gmail.com"
        model.name = "Maya Okafor"
        await model.detectServers()
        model.password = "app password"
        #expect(model.offersGoogleInstead)
        #expect(model.hint == .appPassword)
        await model.addAccount()
        #expect(services.addedInputs.first?.provider == .gmail)
        #expect(services.addedInputs.first?.name == "Maya Okafor")
    }

    @Test("a failed add shows the service message and stays put")
    func addFails() async {
        let (model, _) = make {
            $0.autoconfigResult = .success(AutoconfigResult(server: FakeOnboardingServices.server))
            $0.addResult = .failure(FlintError(.auth, "The server rejected the username or password."))
        }
        await found(model)
        model.password = "wrong"
        await model.addAccount()
        #expect(model.step == .welcome)
        #expect(model.errorText == "The server rejected the username or password.")
        #expect(model.busy == nil)
    }

    @Test("add needs a password and valid servers")
    func addNeedsFields() async {
        let (model, _) = make { $0.autoconfigResult = .success(AutoconfigResult(server: FakeOnboardingServices.server)) }
        await found(model)
        #expect(model.canAdd == false)
        model.password = "pw"
        #expect(model.canAdd)
        model.form.imapPort = "abc"
        #expect(model.canAdd == false)
    }

    // MARK: Google

    @Test("Google sign-in success moves to choices")
    func googleOK() async {
        let (model, services) = make()
        await model.continueWithGoogle(loginHint: "maya@gmail.com")
        #expect(services.googleHints == ["maya@gmail.com"])
        #expect(model.step == .choices)
    }

    @Test("closing the Google sheet shows nothing")
    func googleCancelled() async {
        let (model, _) = make { $0.googleResult = .failure(.googleSignInCancelled) }
        await model.continueWithGoogle()
        #expect(model.errorText == nil)
        #expect(model.step == .welcome)
        #expect(model.busy == nil)
    }

    @Test("a Google failure shows a sentence")
    func googleFails() async {
        let (model, _) = make { $0.googleResult = .failure(FlintError(.auth, "Google sign-in failed.")) }
        await model.continueWithGoogle()
        #expect(model.errorText == "Google sign-in failed.")
        #expect(model.step == .welcome)
    }

    // MARK: Choices and flow

    @Test("choices apply the smart inbox setting")
    func choices() async {
        let (model, services) = make()
        model.smartInbox = false
        await model.applyChoices()
        #expect(services.smartInboxValues == [false])
    }

    @Test("adding another account returns to a clean welcome")
    func another() async {
        let (model, _) = make { $0.autoconfigResult = .success(AutoconfigResult(server: FakeOnboardingServices.server)) }
        await found(model)
        model.password = "pw"
        await model.addAccount()
        model.startAnother()
        #expect(model.step == .welcome)
        #expect(model.email.isEmpty && model.password.isEmpty)
        #expect(model.detection == .idle)
        #expect(model.addedAccount == nil)
    }

    @Test("back leaves Other email for the welcome step")
    func back() {
        let (model, _) = make()
        model.show(.otherEmail)
        model.back()
        #expect(model.step == .welcome)
    }
}

@Suite("Server form and addresses")
struct ServerFormTests {
    @Test("a complete form converts to a server config")
    func config() {
        let form = ServerForm(FakeOnboardingServices.server)
        #expect(form.config == FakeOnboardingServices.server)
    }

    @Test("ports must be numbers from 1 to 65535")
    func ports() {
        var form = ServerForm(FakeOnboardingServices.server)
        for bad in ["", "0", "65536", "99x"] {
            form.imapPort = bad
            #expect(form.config == nil)
        }
        form.imapPort = " 143 "
        #expect(form.config?.imapPort == 143)
    }

    @Test("blank hosts or username are invalid")
    func blanks() {
        var form = ServerForm(FakeOnboardingServices.server)
        form.smtpHost = "  "
        #expect(form.config == nil)
        form = ServerForm(FakeOnboardingServices.server)
        form.username = ""
        #expect(form.config == nil)
    }

    @Test("plausible addresses", arguments: [
        ("maya@example.com", true), (" maya@example.com ", true), ("maya@mail.example.co.uk", true),
        ("maya", false), ("maya@", false), ("@example.com", false), ("maya@example", false),
        ("maya@@example.com", false), ("ma ya@example.com", false), ("maya@example.", false),
    ])
    func plausible(address: String, expected: Bool) {
        #expect(EmailAddress.isPlausible(address) == expected)
    }

    @Test("Google addresses")
    func google() {
        #expect(EmailAddress.isGoogleAddress("a@gmail.com"))
        #expect(EmailAddress.isGoogleAddress("a@GoogleMail.com"))
        #expect(EmailAddress.isGoogleAddress("a@example.com") == false)
    }
}

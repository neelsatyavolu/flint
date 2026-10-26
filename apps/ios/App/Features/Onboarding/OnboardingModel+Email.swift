import FlintMail
import FlintModel
import Foundation

/// The "Other email" path: look up servers, test, add.
extension OnboardingModel {
    /// Looks up servers for the address in `email`. Safe to call on every edit end: a newer call wins over an older one.
    func detectServers() async {
        let address = trimmedEmail
        guard EmailAddress.isPlausible(address) else {
            setDetection(.idle)
            setAdvice(nil, hint: nil)
            return
        }
        noteLookup(domain: address.split(separator: "@").last.map { $0.lowercased() } ?? "")
        let token = nextLookupToken()
        setDetection(.checking)
        clearError()
        async let providerAdvice = services.advice(email: address)
        let found: AutoconfigResult?
        do { found = try await services.autoconfig(email: address) } catch { found = nil }
        let adviceNow = await providerAdvice
        guard isCurrent(token) else { return }
        setAdvice(adviceNow, hint: found?.hint)
        if let found {
            if !serverWasEdited { replaceDetectedForm(ServerForm(found.server)) }
            setDetection(.found)
        } else {
            if !serverWasEdited { replaceDetectedForm(.blank(email: address)) }
            setDetection(.notFound)
            editingServers = true
        }
    }

    func testConnection() async {
        guard canTest, let input = makeInput() else { return }
        setBusy(.testing)
        clearError()
        setCheck(nil)
        defer { setBusy(nil) }
        do { setCheck(try await services.testConnection(input)) } catch { show(error: error) }
    }

    func addAccount() async {
        guard canAdd, let input = makeInput() else { return }
        setBusy(.adding)
        clearError()
        defer { setBusy(nil) }
        do { complete(with: try await services.addAccount(input)) } catch { show(error: error) }
    }

    func makeInput() -> AddAccountInput? {
        guard let server = form.config else { return nil }
        let displayName = name.trimmingCharacters(in: .whitespaces)
        return AddAccountInput(
            email: trimmedEmail,
            name: displayName.isEmpty ? EmailAddress.fallbackName(trimmedEmail) : displayName,
            password: password,
            provider: server.imapHost.lowercased() == "imap.gmail.com" ? .gmail : .imap,
            server: server)
    }

    /// One line per server for the test result, using the service's own messages.
    func outcomeLine(_ outcome: ConnectionOutcome) -> String {
        switch outcome {
        case .ok: String(localized: "Connected", table: "Onboarding")
        case .skipped: String(localized: "Not tried", table: "Onboarding")
        case .failed(let error): error.message
        }
    }
}

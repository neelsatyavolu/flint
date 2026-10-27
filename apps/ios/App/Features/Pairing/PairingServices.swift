import FlintModel
import FlintPairing
import FlintService
import Foundation

/// What the pairing flow needs from the app. The live version wraps `AppModel`; the demo version plays a Mac and touches no network.
@MainActor
protocol PairingServices {
    /// The name the Mac shows in its approval dialog.
    var deviceName: String { get }
    /// True when the camera is replaced by a demo Mac (the simulator has no camera, and demo mailboxes have no Mac to scan).
    var offersDemoMac: Bool { get }
    var demoOffer: PairingOffer? { get }
    func makeClient(offer: PairingOffer) -> PairingClient
    func importer() -> BundleImporter
    /// Remembers the last Mac, by name and date only, for Settings > Devices.
    func rememberPairing(macName: String)
}

/// `FlintService` as the importer's target. Passwords go straight to `addAccount`, which stores them in the Keychain.
struct ServiceImportTarget: ImportTarget {
    let service: FlintService

    func accounts() async throws -> [Account] { try await service.listAccounts() }
    func addAccount(_ input: AddAccountInput) async throws -> Account { try await service.addAccount(input) }
    func addGoogleAccount(loginHint: String?) async throws -> Account { try await service.addGoogleAccount(loginHint: loginHint) }
    func updateAccount(id: AccountID, _ patch: AccountPatch) async throws -> Account { try await service.updateAccount(id: id, patch) }
    func saveSignature(_ signature: Signature) async throws { _ = try await service.saveSignature(signature) }
    func saveTemplate(_ template: Template) async throws { _ = try await service.saveTemplate(template) }
    func saveRule(_ rule: Rule) async throws { _ = try await service.saveRule(rule) }
    func blockSender(_ pattern: String) async throws { try await service.blockSender(pattern) }
    func applySettings(patch: JSONValue) async throws { _ = try await service.updateSettings(patch: patch) }
    func signatures() async throws -> [Signature] { try await service.listSignatures() }
    func templates() async throws -> [Template] { try await service.listTemplates() }
    func rules() async throws -> [Rule] { try await service.listRules() }
    func blockedPatterns() async throws -> [String] { try await service.listBlocked().map(\.pattern) }
}

/// What Settings > Devices remembers about the last Mac: a name and a date. No key, no address.
struct PairedMacRecord: Codable, Equatable {
    var name: String
    var pairedAt: Date

    static let defaultsKey = "flint.pairedMac"

    static func load(_ defaults: UserDefaults) -> PairedMacRecord? {
        defaults.data(forKey: defaultsKey).flatMap { try? JSONDecoder().decode(PairedMacRecord.self, from: $0) }
    }

    func save(_ defaults: UserDefaults) {
        defaults.set(try? JSONEncoder().encode(self), forKey: Self.defaultsKey)
    }
}

struct AppPairingServices: PairingServices {
    let model: AppModel

    var deviceName: String { ThisDevice.name }
    var offersDemoMac: Bool { false }
    var demoOffer: PairingOffer? { nil }

    func makeClient(offer: PairingOffer) -> PairingClient {
        PairingClient(offer: offer, deviceName: deviceName, connector: NetworkConnector.connector)
    }

    func importer() -> BundleImporter {
        guard let service = model.service else { return BundleImporter(target: UnavailableImportTarget()) }
        return BundleImporter(target: ServiceImportTarget(service: service))
    }

    func rememberPairing(macName: String) {
        PairedMacRecord(name: macName, pairedAt: Date()).save(model.defaults)
    }
}

/// Used only if pairing is opened before the mail engine is ready; every call says so.
private struct UnavailableImportTarget: ImportTarget {
    private func fail() -> FlintError { FlintError(.internal, "Flint isn't ready yet. Try again in a moment.") }
    func accounts() async throws -> [Account] { throw fail() }
    func addAccount(_ input: AddAccountInput) async throws -> Account { throw fail() }
    func addGoogleAccount(loginHint: String?) async throws -> Account { throw fail() }
    func updateAccount(id: AccountID, _ patch: AccountPatch) async throws -> Account { throw fail() }
    func saveSignature(_ signature: Signature) async throws { throw fail() }
    func saveTemplate(_ template: Template) async throws { throw fail() }
    func saveRule(_ rule: Rule) async throws { throw fail() }
    func blockSender(_ pattern: String) async throws { throw fail() }
    func applySettings(patch: JSONValue) async throws { throw fail() }
    func signatures() async throws -> [Signature] { throw fail() }
    func templates() async throws -> [Template] { throw fail() }
    func rules() async throws -> [Rule] { throw fail() }
    func blockedPatterns() async throws -> [String] { throw fail() }
}

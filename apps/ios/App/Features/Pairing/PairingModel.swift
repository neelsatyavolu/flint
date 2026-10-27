import FlintModel
import FlintPairing
import Foundation
import Observation

/// State and logic for "Set up from your Mac". Views read it and call its async methods; services are injected.
@MainActor
@Observable
final class PairingModel {
    enum Step: Equatable {
        case intro
        case scan
        /// A `flint://pair` link was opened. Nothing connects until the person confirms the address shown.
        case confirmLink(hosts: String)
        case connecting
        /// The six digits to compare with the Mac, then waiting for the Mac's approval.
        case code(String)
        case review
        case importing
        case done
        case failed(PairingFailure)
    }

    struct PairingFailure: Equatable {
        var message: String
        /// Offer the Settings button (Local Network is off) instead of only "Try again".
        var opensSettings: Bool
    }

    private(set) var step: Step = .intro
    private(set) var plan: ImportPlan?
    private(set) var result: ImportResult?
    private(set) var rowError: String?
    private(set) var busyRow: String?
    var selection = ImportSelection()
    /// Rows (lowercased emails) the person signed in or typed a password for during review. They are on this iPhone now.
    private(set) var addedRows: Set<String> = []
    /// Rows for accounts already on this iPhone that moved to the Mac's servers after the person typed the password again.
    private(set) var switchedRows: Set<String> = []
    private(set) var macName = ""

    @ObservationIgnored private let services: any PairingServices
    @ObservationIgnored private var client: PairingClient?
    @ObservationIgnored private var bundle: PairingBundle?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var linkOffer: PairingOffer?

    /// The fragment of a `flint://pair#...` link the app was opened with (the system Camera scanned the code), if any.
    let pendingPayload: String?

    init(services: any PairingServices, pendingPayload: String? = nil) {
        self.services = services
        self.pendingPayload = pendingPayload
    }

    var offersDemoMac: Bool { services.offersDemoMac }

    // MARK: Steps

    func showScanner() { step = .scan }

    /// A scanned or opened `flint://pair#...` string. Anything else is ignored while scanning, so a stray QR code is not an error.
    func handle(scanned text: String) {
        guard step == .scan || step == .intro, text.hasPrefix(PairingOffer.prefix) else { return }
        do {
            connect(to: try PairingOffer.parse(text))
        } catch {
            step = .failed(failure(error))
        }
    }

    /// A `flint://pair#...` link the app was opened with. It may have come from a web page or a mail rather than the Mac's own screen,
    /// so it stops at a confirm step instead of connecting.
    func handle(link payload: String) {
        guard step == .intro || step == .scan else { return }
        do {
            let offer = try PairingOffer.parse(PairingOffer.prefix + payload)
            linkOffer = offer
            step = .confirmLink(hosts: offer.addrs.joined(separator: ", "))
        } catch {
            step = .failed(failure(error))
        }
    }

    /// "Connect" on the confirm step.
    func confirmLink() {
        guard case .confirmLink = step, let offer = linkOffer else { return }
        linkOffer = nil
        connect(to: offer)
    }

    func useDemoMac() {
        if let offer = services.demoOffer { connect(to: offer) }
    }

    func connect(to offer: PairingOffer) {
        task?.cancel()
        step = .connecting
        let client = services.makeClient(offer: offer)
        self.client = client
        task = Task { [weak self] in await self?.run(client) }
    }

    func cancel() {
        task?.cancel()
        task = nil
        let client = self.client
        self.client = nil
        bundle = nil
        linkOffer = nil
        Task { await client?.close() }
        if case .done = step { return }
        step = .intro
    }

    func retry() {
        cancel()
        step = .scan
    }

    // MARK: Connect and receive

    private func run(_ client: PairingClient) async {
        do {
            let sas = try await client.connect()
            guard !Task.isCancelled else { return }
            step = .code(PairingCrypto.format(sas: sas))
            let received = try await client.receiveBundle()
            guard !Task.isCancelled else { return }
            bundle = received
            macName = received.device.name
            try await refreshPlan()
            step = .review
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            await client.close()
            step = .failed(failure(error))
        }
    }

    private func refreshPlan() async throws {
        guard let bundle else { return }
        let library = try await services.importer().library()
        plan = ImportPlan.make(bundle: bundle, library: library)
    }

    // MARK: Review

    func signIn(_ row: PlannedAccount) async {
        await perform(row.id) { try await $0.signInGoogle(row.account) }
    }

    func addPassword(_ row: PlannedAccount, password: String) async {
        if row.existsOnPhone {
            await perform(row.id, switched: true) { try await $0.switchServers(row.account, password: password) }
        } else {
            await perform(row.id) { try await $0.addPasswordAccount(row.account, password: password) }
        }
    }

    private func perform(_ id: String, switched: Bool = false, _ work: (BundleImporter) async throws -> Account) async {
        guard busyRow == nil else { return }
        busyRow = id
        rowError = nil
        defer { busyRow = nil }
        do {
            _ = try await work(services.importer())
            if switched { switchedRows.insert(id) } else { addedRows.insert(id) }
            try await refreshPlan()
        } catch {
            rowError = FlintErrorText.isSilent(error) ? nil : FlintErrorText.message(for: error)
        }
    }

    /// Imports what the review shows, tells the Mac, and finishes.
    func confirm() async {
        guard let plan, step == .review else { return }
        step = .importing
        let outcome = await services.importer().apply(plan, selection)
        result = outcome
        services.rememberPairing(macName: macName)
        let added = ImportCounts(
            accounts: outcome.added.accounts + addedRows.count, signatures: outcome.added.signatures, templates: outcome.added.templates,
            rules: outcome.added.rules, blockedSenders: outcome.added.blockedSenders)
        try? await client?.acknowledge(added)
        client = nil
        step = .done
    }

    // MARK: Summary

    /// Accounts the Mac listed that are still not on this iPhone because they need a sign-in or a password.
    var accountsStillNeedingSignIn: Int { plan?.accountsNeedingCredentials.count ?? 0 }

    /// Accounts already on this iPhone before pairing, where the person may choose the Mac's details.
    var conflictingRows: [PlannedAccount] { plan?.conflictingAccounts.filter { !addedRows.contains($0.id) && !switchedRows.contains($0.id) } ?? [] }

    /// Rows still waiting for a Google sign-in or a password.
    var pendingRows: [PlannedAccount] {
        guard let plan else { return [] }
        return plan.accountsNeedingCredentials + plan.serverSwitches.filter { !switchedRows.contains($0.id) }
    }

    /// Rows the Mac sent with a password, or that were added during review.
    var readyRows: [PlannedAccount] {
        plan?.accounts.filter { ($0.credential == .ready && !$0.existsOnPhone) || addedRows.contains($0.id) || switchedRows.contains($0.id) } ?? []
    }

    private func failure(_ error: any Error) -> PairingFailure {
        if let pairing = error as? PairingError {
            return PairingFailure(message: pairing.errorDescription ?? "", opensSettings: pairing == .localNetworkDenied)
        }
        return PairingFailure(message: FlintErrorText.message(for: error), opensSettings: false)
    }
}

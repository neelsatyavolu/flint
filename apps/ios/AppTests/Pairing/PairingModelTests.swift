@testable import Flint
import FlintModel
import FlintPairing
import Foundation
import Testing

/// Drives `PairingModel` through the real `PairingClient` against the in-app demo Mac (no network, made-up accounts).
@MainActor
@Suite("Pairing model", .serialized)
struct PairingModelTests {
    private func waitFor(_ model: PairingModel, timeout: Duration = .seconds(10), _ done: (PairingModel.Step) -> Bool) async -> Bool {
        let end = ContinuousClock.now + timeout
        while ContinuousClock.now < end {
            if done(model.step) { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return false
    }

    private func reachReview(_ services: DemoPairingServices = DemoPairingServices()) async -> PairingModel {
        let model = PairingModel(services: services)
        model.showScanner()
        model.useDemoMac()
        _ = await waitFor(model) { $0 == .review }
        return model
    }

    @Test("the demo Mac shows a six digit code, then the review")
    func codeThenReview() async {
        let model = PairingModel(services: DemoPairingServices())
        model.showScanner()
        model.useDemoMac()
        #expect(await waitFor(model) { if case .code(let d) = $0 { return d.count == 7 && d.contains(" ") } else { return false } })
        #expect(await waitFor(model) { $0 == .review })
        #expect(model.macName == "Demo MacBook Pro")
    }

    @Test("Google is a Sign in row and the password account is ready; nothing is added before confirm")
    func reviewRows() async throws {
        let model = await reachReview()
        #expect(model.readyRows.map(\.account.email) == ["demo.work@example.com"])
        #expect(model.pendingRows.map(\.account.email) == ["demo.home@gmail.com"])
        #expect(model.pendingRows.first?.credential == .needsGoogleSignIn)
        #expect(model.conflictingRows.isEmpty)
        let plan = try #require(model.plan)
        #expect(plan.signatures.count == 1 && plan.templates.count == 2 && plan.rules.count == 1 && plan.blockedSenders.count == 1)
        #expect(model.result == nil)
    }

    @Test("signing in a Google row moves it to Added, and confirm finishes with the counts")
    func signInThenConfirm() async throws {
        let model = await reachReview()
        let row = try #require(model.pendingRows.first)
        await model.signIn(row)
        #expect(model.rowError == nil)
        #expect(model.pendingRows.isEmpty)
        #expect(model.addedRows == [row.id])
        await model.confirm()
        #expect(model.step == .done)
        let added = try #require(model.result).added
        #expect(added.accounts == 1)
        #expect(added.signatures == 1 && added.templates == 2 && added.rules == 1 && added.blockedSenders == 1)
        #expect(model.accountsStillNeedingSignIn == 0)
    }

    @Test("confirming without signing in leaves Google as still needed")
    func confirmLeavesGoogle() async throws {
        let model = await reachReview()
        await model.confirm()
        #expect(model.step == .done)
        #expect(model.accountsStillNeedingSignIn == 1)
        #expect(try #require(model.result).skippedNoAccount == 0)
    }

    @Test("turning the library off imports accounts only")
    func libraryOff() async throws {
        let model = await reachReview()
        model.selection.includeLibrary = false
        model.selection.includeSettings = false
        await model.confirm()
        let result = try #require(model.result)
        #expect(result.added == ImportCounts(accounts: 1))
        #expect(!result.settingsApplied)
    }

    @Test("cancel from the code step returns to the start and closes the connection")
    func cancelAtCode() async {
        let model = PairingModel(services: DemoPairingServices())
        model.showScanner()
        model.useDemoMac()
        #expect(await waitFor(model) { if case .code = $0 { return true } else { return false } })
        model.cancel()
        #expect(model.step == .intro)
    }

    @Test("a QR code that is not Flint's is ignored while scanning; a broken Flint code fails")
    func scannedText() async {
        let model = PairingModel(services: DemoPairingServices())
        model.showScanner()
        model.handle(scanned: "https://example.com")
        #expect(model.step == .scan)
        model.handle(scanned: "flint://pair#not-base64")
        guard case .failed(let failure) = model.step else { Issue.record("expected a failure"); return }
        #expect(failure.message.contains("pairing code"))
        #expect(!failure.opensSettings)
        model.retry()
        #expect(model.step == .scan)
    }

    @Test("a pairing link stops at a confirm step and connects only after Connect")
    func linkNeedsConfirm() async throws {
        final class Spy: @unchecked Sendable { var clients = 0 }
        struct Counting: PairingServices {
            let demo = DemoPairingServices()
            let spy: Spy
            var deviceName: String { "iPhone" }
            var offersDemoMac: Bool { false }
            var demoOffer: PairingOffer? { nil }
            func makeClient(offer: PairingOffer) -> PairingClient { spy.clients += 1; return demo.makeClient(offer: offer) }
            func importer() -> BundleImporter { demo.importer() }
            func rememberPairing(macName: String) {}
        }
        let spy = Spy()
        let demo = DemoPairingServices()
        let payload = String(demo.mac.offer.urlString.dropFirst(PairingOffer.prefix.count))
        let model = PairingModel(services: Counting(spy: spy), pendingPayload: payload)
        model.handle(link: payload)
        guard case .confirmLink(let hosts) = model.step else { Issue.record("expected the confirm step, got \(model.step)"); return }
        #expect(hosts == "192.168.1.20")
        try await Task.sleep(for: .milliseconds(200))
        #expect(spy.clients == 0)
        model.cancel()
        #expect(model.step == .intro && spy.clients == 0)
        model.handle(link: payload)
        model.confirmLink()
        #expect(model.step == .connecting || spy.clients == 1)
        #expect(spy.clients == 1)
    }

    @Test("a link to a public host fails at once and never reaches the confirm step")
    func linkToPublicHost() {
        let object: [String: Any] = ["v": 1, "sid": Data(repeating: 1, count: 16).base64URL, "pk": Data(repeating: 2, count: 32).base64URL, "addrs": ["pair.evil.example"], "port": 4000]
        let payload = ((try? JSONSerialization.data(withJSONObject: object)) ?? Data()).base64URL
        let model = PairingModel(services: DemoPairingServices())
        model.handle(link: payload)
        guard case .failed = model.step else { Issue.record("expected a failure"); return }
    }

    @Test("a refused Local Network permission offers the Settings button")
    func localNetworkDenied() async {
        struct Denied: PairingServices {
            let demo = DemoPairingServices()
            var deviceName: String { "iPhone" }
            var offersDemoMac: Bool { false }
            var demoOffer: PairingOffer? { nil }
            func makeClient(offer: PairingOffer) -> PairingClient { PairingClient(offer: offer, deviceName: "iPhone", connector: { _, _ in throw PairingError.localNetworkDenied }) }
            func importer() -> BundleImporter { demo.importer() }
            func rememberPairing(macName: String) {}
        }
        let demo = DemoPairingServices()
        let model = PairingModel(services: Denied())
        model.showScanner()
        model.handle(scanned: demo.mac.offer.urlString)
        #expect(await waitFor(model) { if case .failed = $0 { return true } else { return false } })
        guard case .failed(let failure) = model.step else { return }
        #expect(failure.opensSettings && failure.message.contains("Local Network"))
    }
}

@Suite("Pairing text")
struct PairingTextTests {
    @Test("counts read as a sentence and leave zeros out")
    func added() {
        #expect(PairingText.added(ImportCounts(accounts: 2, signatures: 1, rules: 12)) == "Added 2 accounts, 1 signature, 12 rules.")
        #expect(PairingText.added(ImportCounts(accounts: 1, blockedSenders: 3)) == "Added 1 account, 3 blocked senders.")
        #expect(PairingText.added(ImportCounts()).hasPrefix("Nothing new"))
    }

    @Test("sign in notes")
    func needs() {
        #expect(PairingText.stillNeeds(google: 0, password: 0).isEmpty)
        #expect(PairingText.stillNeeds(google: 2, password: 0).first?.hasPrefix("2 accounts need Google sign-in") == true)
        #expect(PairingText.stillNeeds(google: 1, password: 1).count == 2)
    }

    @Test("no exclamation marks in any pairing sentence")
    func tone() {
        let samples = [PairingText.added(ImportCounts(accounts: 1)), PairingText.libraryDetail(new: 2, already: 1)] + PairingText.stillNeeds(google: 1, password: 1)
        #expect(samples.allSatisfy { !$0.contains("!") })
    }

    @Test("last Mac is stored as a name and a date only")
    func record() throws {
        let defaults = try #require(UserDefaults(suiteName: "pairing-record-test"))
        defer { defaults.removePersistentDomain(forName: "pairing-record-test") }
        let record = PairedMacRecord(name: "Neel's MacBook Pro", pairedAt: Date(timeIntervalSince1970: 1_790_000_000))
        record.save(defaults)
        #expect(PairedMacRecord.load(defaults) == record)
        let raw = try #require(defaults.data(forKey: PairedMacRecord.defaultsKey))
        let object = try #require(try JSONSerialization.jsonObject(with: raw) as? [String: Any])
        #expect(Set(object.keys) == ["name", "pairedAt"])
    }
}

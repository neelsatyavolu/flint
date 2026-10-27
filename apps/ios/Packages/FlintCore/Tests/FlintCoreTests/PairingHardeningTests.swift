import FlintModel
import Foundation
import Testing
@testable import FlintPairing

@Suite("Pairing hardening")
struct PairingHardeningTests {
    // MARK: Hosts in a link

    private func offer(addrs: [String]) -> String {
        PairingOffer(sid: Data(count: 16), macPublic: Data(repeating: 7, count: 32), addrs: addrs, port: 4000).urlString
    }

    @Test(arguments: ["192.168.1.20", "10.0.0.5", "172.16.0.1", "172.31.255.254", "169.254.10.2", "127.0.0.1", "fe80::1", "fe80::1%en0", "fd12:3456::9", "::1", "neels-mac.local", "Neels-Mac.LOCAL"])
    func localHostsAreAccepted(_ host: String) throws {
        #expect(PairingOffer.isLocalHost(host))
        #expect(try PairingOffer.parse(offer(addrs: [host])).addrs == [host])
    }

    @Test(arguments: ["pair.evil.example", "8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.1.1", "11.0.0.1", "1.2.3", "10.0.0.256", "2001:4860:4860::8888", "evil.local.example.com", ".local", "local", "a b.local", "::ffff:8.8.8.8", "10.0.0.1.evil.com", ""])
    func publicHostsAreRefused(_ host: String) {
        #expect(!PairingOffer.isLocalHost(host))
        #expect(throws: PairingError.badQRCode) { try PairingOffer.parse(offer(addrs: [host])) }
    }

    @Test func oneBadAddressRefusesTheWholeLink() {
        #expect(throws: PairingError.badQRCode) { try PairingOffer.parse(offer(addrs: ["192.168.1.2", "pair.evil.example"])) }
    }

    // MARK: Code commits to both keys

    @Test func theCodeChangesWhenEitherPublicKeyChanges() throws {
        let mac = PairingKeypair.generate(), phone = PairingKeypair.generate(), other = PairingKeypair.generate()
        let shared = try PairingCrypto.sharedSecret(privateKey: mac.privateKey, peerPublic: phone.publicKey)
        let sid = Data(repeating: 3, count: 16)
        let base = PairingCrypto.deriveSession(shared: shared, sid: sid, macPublic: mac.publicKey, phonePublic: phone.publicKey).sas
        let swappedPhone = PairingCrypto.deriveSession(shared: shared, sid: sid, macPublic: mac.publicKey, phonePublic: other.publicKey).sas
        let swappedMac = PairingCrypto.deriveSession(shared: shared, sid: sid, macPublic: other.publicKey, phonePublic: phone.publicKey).sas
        #expect(base != swappedPhone && base != swappedMac)
    }

    // MARK: Second pairing merges

    @Test func libraryReadsWhatThePhoneAlreadyHas() async throws {
        let target = FakeTarget(accounts: [phoneAccount("neel@example.com")])
        let importer = BundleImporter(target: target)
        let first = ImportPlan.make(bundle: try bundle(), library: try await importer.library())
        _ = await importer.apply(first, ImportSelection())
        let second = ImportPlan.make(bundle: try bundle(), library: try await importer.library())
        #expect(second.signatures.isEmpty && second.templates.isEmpty && second.rules.isEmpty && second.blockedSenders.isEmpty)
        #expect(second.alreadyHere.signatures == 1 && second.alreadyHere.templates == 1 && second.alreadyHere.rules == 1 && second.alreadyHere.blockedSenders == 2)
    }

    @Test func pairingTwiceAddsNoDuplicates() async throws {
        let target = FakeTarget()
        let importer = BundleImporter(target: target)
        for _ in 0..<2 {
            let plan = ImportPlan.make(bundle: try bundle(), library: try await importer.library())
            _ = await importer.apply(plan, ImportSelection())
        }
        #expect(await target.signatures.count == 1)
        #expect(await target.templates.count == 1)
        #expect(await target.rules.count == 1)
        #expect(await target.blocked.count == 2)
        #expect(await target.stored.count == 1)
    }

    // MARK: Receipts need their own consent

    @Test func receiptsAreNotAppliedByDefault() async throws {
        let target = FakeTarget()
        let plan = ImportPlan.make(bundle: try bundle(), library: ImportLibrary())
        #expect(plan.hasReceipts && plan.settings.receiptsHost == "receipts.example.com")
        _ = await BundleImporter(target: target).apply(plan, ImportSelection())
        let patch = try #require(await target.settingsPatches.first)
        #expect(patch.object?["receipts"] == nil)
        #expect(patch.object?["inbox"] != nil)
    }

    @Test func receiptsGoThroughOnlyWhenTicked() async throws {
        let target = FakeTarget()
        let plan = ImportPlan.make(bundle: try bundle(), library: ImportLibrary())
        _ = await BundleImporter(target: target).apply(plan, ImportSelection(includeReceipts: true))
        let patch = try #require(await target.settingsPatches.first)
        #expect(patch.object?["receipts"]?.object?["endpoint"]?.string == "https://receipts.example.com")
    }

    @Test func receiptsCanBeTickedWithoutTheOtherSettings() async throws {
        let target = FakeTarget()
        let plan = ImportPlan.make(bundle: try bundle(), library: ImportLibrary())
        _ = await BundleImporter(target: target).apply(plan, ImportSelection(includeSettings: false, includeReceipts: true))
        let patch = try #require(await target.settingsPatches.first)
        #expect(Set(patch.object?.keys.map { $0 } ?? []) == ["receipts"])
    }

    @Test func turningEverythingOffSendsNoSettings() async throws {
        let target = FakeTarget()
        let plan = ImportPlan.make(bundle: try bundle(), library: ImportLibrary())
        let result = await BundleImporter(target: target).apply(plan, ImportSelection(includeSettings: false, includeReceipts: false))
        #expect(await target.settingsPatches.isEmpty && !result.settingsApplied)
    }

    // MARK: A silent Mac

    @Test func theCodeScreenGivesUpWhenTheMacGoesQuiet() async throws {
        let mac = ScriptedMac()
        let client = PairingClient(offer: mac.offer, deviceName: "Test iPhone", connector: mac.connector, receiveTimeout: .milliseconds(150))
        _ = try await client.connect()
        await #expect(throws: PairingError.timedOut) { try await client.receiveBundle() }
        #expect(mac.closed)
    }

    @Test func aBundleThatArrivesInTimeIsNotCutOff() async throws {
        let mac = ScriptedMac()
        let client = PairingClient(offer: mac.offer, deviceName: "Test iPhone", connector: mac.connector, receiveTimeout: .seconds(5))
        _ = try await client.connect()
        _ = try mac.readHello(from: mac.sentFrames())
        try mac.pushBundle(sampleBundleData())
        #expect(try await client.receiveBundle().accounts.count == 2)
        #expect(PairingClient.defaultReceiveTimeout > .seconds(180))
    }
}

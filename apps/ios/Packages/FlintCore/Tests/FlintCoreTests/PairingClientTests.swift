import FlintModel
import Foundation
import Testing
@testable import FlintPairing

@Suite("Pairing client")
struct PairingClientTests {
    private func start(_ mac: ScriptedMac) async throws -> (PairingClient, String) {
        let client = PairingClient(offer: mac.offer, deviceName: "Test iPhone", connector: mac.connector)
        let sas = try await client.connect()
        #expect(try mac.readHello(from: mac.sentFrames()) == sas)
        return (client, sas)
    }

    @Test func pairsAndAcknowledges() async throws {
        let mac = ScriptedMac()
        let (client, sas) = try await start(mac)
        #expect(sas.count == 6)
        try mac.pushBundle(sampleBundleData(), chunk: 400)
        let bundle = try await client.receiveBundle()
        #expect(bundle.accounts.count == 2)
        try await client.acknowledge(ImportCounts(accounts: 2, signatures: 1, templates: 1, rules: 1, blockedSenders: 2))
        let frames = try mac.sentFrames()
        #expect(frames.map(\.type) == [PairingFrameType.hello, PairingFrameType.ack])
        #expect(try mac.openAck(frames[1]) == ImportCounts(accounts: 2, signatures: 1, templates: 1, rules: 1, blockedSenders: 2))
        #expect(mac.closed)
    }

    @Test func sendsOnlyTheDocumentedHello() async throws {
        let mac = ScriptedMac()
        _ = try await start(mac)
        let hello = try #require(mac.sentFrames().first)
        #expect(hello.type == PairingFrameType.hello)
        let object = try #require(JSONSerialization.jsonObject(with: hello.body) as? [String: Any])
        #expect(Set(object.keys) == ["v", "sid", "pk", "name"])
        #expect(object["name"] as? String == "Test iPhone")
        #expect(object["sid"] as? String == mac.sid.base64URL)
    }

    @Test func aMacThatPinsADifferentKeyShowsADifferentCode() async throws {
        let real = ScriptedMac()
        let (_, sas) = try await start(real)
        let impostor = PairingKeypair.generate()
        let shared = try PairingCrypto.sharedSecret(privateKey: impostor.privateKey, peerPublic: try #require(real.phonePublic))
        let theirs = PairingCrypto.deriveSession(shared: shared, sid: real.sid, macPublic: impostor.publicKey, phonePublic: try #require(real.phonePublic))
        #expect(theirs.sas != sas)
    }

    @Test func failsClosedOnATamperedChunk() async throws {
        let mac = ScriptedMac()
        let (client, _) = try await start(mac)
        try mac.push(mac.sealedFrame(type: PairingFrameType.ready, plaintext: Data()))
        var frame = try mac.sealedFrame(type: PairingFrameType.bundle, plaintext: Data([1]) + sampleBundleData())
        frame[frame.count - 20] ^= 1
        mac.push(frame)
        await #expect(throws: PairingError.tampered) { try await client.receiveBundle() }
        #expect(mac.closed)
    }

    @Test func failsClosedOnAReplayedChunk() async throws {
        let mac = ScriptedMac()
        let (client, _) = try await start(mac)
        try mac.push(mac.sealedFrame(type: PairingFrameType.ready, plaintext: Data()))
        let chunk = try mac.sealedFrame(type: PairingFrameType.bundle, plaintext: Data([0]) + Data("{".utf8))
        mac.push(chunk)
        mac.push(chunk)
        await #expect(throws: PairingError.tampered) { try await client.receiveBundle() }
        #expect(mac.closed)
    }

    @Test func failsClosedWhenTheBundleComesBeforeReady() async throws {
        let mac = ScriptedMac()
        let (client, _) = try await start(mac)
        try mac.push(mac.sealedFrame(type: PairingFrameType.bundle, plaintext: Data([1]) + sampleBundleData()))
        await #expect(throws: PairingError.self) { try await client.receiveBundle() }
        #expect(mac.closed)
    }

    @Test func failsClosedOnAnOversizeFrame() async throws {
        let mac = ScriptedMac()
        let (client, _) = try await start(mac)
        mac.push(Data([0, 1, 0, 1, 3]))
        await #expect(throws: PairingError.badFrame) { try await client.receiveBundle() }
        #expect(mac.closed)
    }

    @Test func failsClosedOnABadChunkFlag() async throws {
        let mac = ScriptedMac()
        let (client, _) = try await start(mac)
        try mac.push(mac.sealedFrame(type: PairingFrameType.ready, plaintext: Data()))
        try mac.push(mac.sealedFrame(type: PairingFrameType.bundle, plaintext: Data([7, 1, 2])))
        await #expect(throws: PairingError.badFrame) { try await client.receiveBundle() }
    }

    @Test func stopsAtTheBundleSizeCap() async throws {
        let mac = ScriptedMac()
        let (client, _) = try await start(mac)
        try mac.push(mac.sealedFrame(type: PairingFrameType.ready, plaintext: Data()))
        let chunk = Data([0]) + Data(repeating: 32, count: PairingLimits.chunkSize)
        for _ in 0...(PairingLimits.maxBundleBytes / PairingLimits.chunkSize) { try mac.push(mac.sealedFrame(type: PairingFrameType.bundle, plaintext: chunk)) }
        await #expect(throws: PairingError.bundleTooLarge) { try await client.receiveBundle() }
    }

    @Test func rejectsABundleThatDoesNotMatchTheSchema() async throws {
        let mac = ScriptedMac()
        let (client, _) = try await start(mac)
        try mac.pushBundle(Data(#"{"v":1,"accounts":"nope"}"#.utf8))
        await #expect(throws: PairingError.malformedBundle) { try await client.receiveBundle() }
        #expect(mac.closed)
    }

    @Test func reportsAMacThatClosesBeforeApproval() async throws {
        let mac = ScriptedMac()
        let (client, _) = try await start(mac)
        mac.markClosedForTest()
        await #expect(throws: PairingError.connectionClosed) { try await client.receiveBundle() }
    }

    @Test func cancelClosesTheConnection() async throws {
        let mac = ScriptedMac()
        let (client, _) = try await start(mac)
        await client.close()
        #expect(mac.closed)
        await #expect(throws: PairingError.connectionClosed) { try await client.receiveBundle() }
    }

    @Test func refusesAWeakMacKey() async {
        let mac = ScriptedMac()
        let offer = PairingOffer(sid: mac.sid, macPublic: Data(count: 32), addrs: ["127.0.0.1"], port: 1)
        let client = PairingClient(offer: offer, deviceName: "x", connector: mac.connector)
        await #expect(throws: PairingError.weakKey) { try await client.connect() }
        #expect(mac.closed)
    }

    @Test func surfacesAnUnreachableMac() async {
        let client = PairingClient(offer: ScriptedMac().offer, deviceName: "x", connector: { _, _ in throw PairingError.unreachable })
        await #expect(throws: PairingError.unreachable) { try await client.connect() }
    }
}

extension ScriptedMac {
    func markClosedForTest() { push(Data()); markClosedExternally() }
}

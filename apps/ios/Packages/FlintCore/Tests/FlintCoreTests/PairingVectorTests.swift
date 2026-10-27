import CryptoKit
import FlintModel
import Foundation
import Testing
@testable import FlintPairing

@Suite("Pairing vectors")
struct PairingVectorTests {
    @Test func derivesEveryKeyAndCodeInTheFixture() throws {
        let cases = try PairingFixtures.cases("pairing-vectors").filter { $0.input.object?["macPrivate"] != nil }
        #expect(cases.count >= 3)
        for c in cases {
            let i = c.input.object!, e = c.expect.object!
            let mac = try PairingKeypair(privateKey: Data(hex: i["macPrivate"]!.string!))
            let phone = try PairingKeypair(privateKey: Data(hex: i["phonePrivate"]!.string!))
            #expect(mac.publicKey.hex == e["macPublic"]!.string!, "\(c.name)")
            #expect(phone.publicKey.hex == e["phonePublic"]!.string!, "\(c.name)")
            let shared = try PairingCrypto.sharedSecret(privateKey: phone.privateKey, peerPublic: mac.publicKey)
            #expect(shared.hex == e["shared"]!.string!, "\(c.name)")
            #expect(try PairingCrypto.sharedSecret(privateKey: mac.privateKey, peerPublic: phone.publicKey) == shared)
            let keys = PairingCrypto.deriveSession(shared: shared, sid: Data(hex: i["sid"]!.string!), macPublic: mac.publicKey, phonePublic: phone.publicKey)
            #expect(keys.macToPhone.withUnsafeBytes { Data($0).hex } == e["keyMacToPhone"]!.string!, "\(c.name)")
            #expect(keys.phoneToMac.withUnsafeBytes { Data($0).hex } == e["keyPhoneToMac"]!.string!, "\(c.name)")
            #expect(keys.sas == e["sas"]!.string!, "\(c.name)")
        }
    }

    @Test func coversAZeroPaddedCode() throws {
        let sases = try PairingFixtures.cases("pairing-vectors").compactMap { $0.expect.object?["sas"]?.string }
        #expect(sases.contains { $0.hasPrefix("0") })
        #expect(PairingCrypto.format(sas: "048213") == "048 213")
    }

    @Test func sealsAndOpensEverySealedFrame() throws {
        let cases = try PairingFixtures.cases("pairing-vectors").filter { $0.input.object?["direction"] != nil }
        #expect(cases.count >= 4)
        for c in cases {
            let i = c.input.object!, e = c.expect.object!
            let direction: PairingDirection = i["direction"]!.string! == "macToPhone" ? .macToPhone : .phoneToMac
            let key = SymmetricKey(data: Data(hex: i["key"]!.string!))
            let sid = Data(hex: i["sid"]!.string!), type = UInt8(i["type"]!.int!), counter = UInt64(i["counter"]!.int!)
            let plain = Data(hex: i["plaintext"]!.string!)
            #expect(PairingCrypto.nonce(counter: counter).hex == e["nonce"]!.string!, "\(c.name)")
            let sealed = try PairingCrypto.seal(key: key, sid: sid, direction: direction, type: type, counter: counter, plaintext: plain)
            #expect(sealed.hex == e["sealed"]!.string!, "\(c.name)")
            #expect(try encodeFrame(type: type, body: sealed).hex == e["frame"]!.string!, "\(c.name)")
            #expect(try PairingCrypto.open(key: key, sid: sid, direction: direction, type: type, counter: counter, sealed: Data(hex: e["sealed"]!.string!)) == plain)
        }
    }

    @Test func rejectsTamperedWrongCounterWrongDirectionAndWrongType() throws {
        let c = try PairingFixtures.cases("pairing-vectors").first { $0.name == "bundle chunk, counter 1" }!
        let i = c.input.object!
        let key = SymmetricKey(data: Data(hex: i["key"]!.string!)), sid = Data(hex: i["sid"]!.string!)
        let sealed = Data(hex: c.expect.object!["sealed"]!.string!)
        func open(_ k: SymmetricKey = key, _ s: Data = sid, _ d: PairingDirection = .macToPhone, _ t: UInt8 = 3, _ n: UInt64 = 1, _ data: Data = sealed) throws {
            _ = try PairingCrypto.open(key: k, sid: s, direction: d, type: t, counter: n, sealed: data)
        }
        try open()
        var flipped = sealed
        flipped[flipped.startIndex] ^= 1
        #expect(throws: PairingError.tampered) { try open(key, sid, .macToPhone, 3, 1, flipped) }
        #expect(throws: PairingError.tampered) { try open(key, sid, .macToPhone, 3, 2) }
        #expect(throws: PairingError.tampered) { try open(key, sid, .phoneToMac) }
        #expect(throws: PairingError.tampered) { try open(key, sid, .macToPhone, 2) }
        #expect(throws: PairingError.tampered) { try open(key, Data(repeating: 1, count: 16)) }
        #expect(throws: PairingError.tampered) { try open(SymmetricKey(data: Data(repeating: 9, count: 32))) }
        #expect(throws: PairingError.tampered) { try open(key, sid, .macToPhone, 3, 1, Data([1, 2, 3])) }
    }

    @Test func openerRejectsReplayAndReorder() throws {
        let key = SymmetricKey(data: Data(repeating: 5, count: 32)), sid = Data(repeating: 1, count: 16)
        var sealer = FrameSealer(key: key, sid: sid, direction: .macToPhone)
        let first = try sealer.seal(type: 3, plaintext: Data("one".utf8)), second = try sealer.seal(type: 3, plaintext: Data("two".utf8))
        var opener = FrameOpener(key: key, sid: sid, direction: .macToPhone)
        #expect(throws: PairingError.tampered) { try opener.open(type: 3, sealed: second) }
        #expect(try opener.open(type: 3, sealed: first) == Data("one".utf8))
        #expect(throws: PairingError.tampered) { try opener.open(type: 3, sealed: first) }
        #expect(try opener.open(type: 3, sealed: second) == Data("two".utf8))
    }

    @Test func rejectsWeakKeys() throws {
        let mine = PairingKeypair.generate()
        #expect(throws: PairingError.weakKey) { try PairingCrypto.sharedSecret(privateKey: mine.privateKey, peerPublic: Data(count: 32)) }
        #expect(throws: PairingError.weakKey) { try PairingCrypto.sharedSecret(privateKey: mine.privateKey, peerPublic: Data(count: 31)) }
    }

    @Test func parsesTheQRPayloadFromTheFixture() throws {
        let c = try PairingFixtures.cases("pairing-vectors").first { $0.name == "qr payload" }!
        let offer = try PairingOffer.parse(c.expect.object!["url"]!.string!)
        #expect(offer.sid.hex == c.input.object!["sid"]!.string!)
        #expect(offer.macPublic.hex == c.input.object!["macPublic"]!.string!)
        #expect(offer.addrs == ["192.168.1.20", "10.0.0.5"])
        #expect(offer.port == 49152)
        #expect(try PairingOffer.parse(offer.urlString) == offer)
    }

    @Test func rejectsMalformedQRPayloads() throws {
        func url(_ o: [String: Any]) -> String { PairingOffer.prefix + ((try? JSONSerialization.data(withJSONObject: o)) ?? Data()).base64URL }
        let good: [String: Any] = ["v": 1, "sid": Data(repeating: 1, count: 16).base64URL, "pk": Data(repeating: 2, count: 32).base64URL, "addrs": ["1.2.3.4"], "port": 80]
        _ = try PairingOffer.parse(url(good))
        let bads: [[String: Any]] = [["v": 0], ["sid": "AA"], ["pk": "AA"], ["addrs": [String]()], ["addrs": ["1", "2", "3", "4"]], ["port": 0], ["port": 70000], ["addrs": [""]]]
        for patch in bads { #expect(throws: PairingError.badQRCode) { try PairingOffer.parse(url(good.merging(patch) { $1 })) } }
        #expect(throws: PairingError.unsupportedVersion) { try PairingOffer.parse(url(good.merging(["v": 2]) { $1 })) }
        #expect(throws: PairingError.badQRCode) { try PairingOffer.parse("https://example.com") }
        #expect(throws: PairingError.badQRCode) { try PairingOffer.parse("flint://pair#***") }
        #expect(throws: PairingError.badQRCode) { try PairingOffer.parse(PairingOffer.prefix + Data("nope".utf8).base64URL) }
    }

    @Test func appliesTheFramingRules() throws {
        let framing = try PairingFixtures.load("pairing-vectors")["framing"]!.object!
        for r in framing["rejects"]!.array! {
            var decoder = FrameDecoder()
            #expect(throws: PairingError.badFrame, "\(r.object!["name"]!.string!)") { try decoder.push(Data(hex: r.object!["hex"]!.string!)) }
        }
        for r in framing["accepts"]!.array! {
            var decoder = FrameDecoder()
            #expect(try decoder.push(Data(hex: r.object!["hex"]!.string!)).isEmpty)
        }
        #expect(throws: PairingError.badFrame) { try encodeFrame(type: 1, body: Data(count: PairingLimits.maxFrame)) }
    }

    @Test func reassemblesSplitFrames() throws {
        var decoder = FrameDecoder()
        let wire = try encodeFrame(type: 1, body: Data("abc".utf8)) + encodeFrame(type: 2, body: Data())
        #expect(try decoder.push(wire.prefix(3)).isEmpty)
        #expect(try decoder.push(wire.dropFirst(3).prefix(3)).isEmpty)
        let out = try decoder.push(wire.dropFirst(6))
        #expect(out.map(\.type) == [1, 2])
        #expect(out[0].body == Data("abc".utf8))
    }

    @Test func buildsTheSameHelloAsTheMac() throws {
        let c = try PairingFixtures.cases("pairing-vectors").first { $0.name == "hello body" }!
        let json = try JSONSerialization.jsonObject(with: Data(c.expect.object!["json"]!.string!.utf8)) as! [String: Any]
        #expect(Set(json.keys) == ["v", "sid", "pk", "name"])
        #expect(json["pk"] as? String == Data(hex: c.input.object!["phonePublic"]!.string!).base64URL)
    }
}

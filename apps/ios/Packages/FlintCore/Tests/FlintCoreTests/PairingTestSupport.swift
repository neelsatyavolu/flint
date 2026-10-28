import CryptoKit
import Testing
import FlintModel
import Foundation
@testable import FlintPairing

/// A scripted Mac for client tests: holds the Mac's key, reads the phone's HELLO and writes sealed frames.
final class ScriptedMac: @unchecked Sendable {
    let keypair = PairingKeypair.generate()
    let sid = Data((0..<16).map { UInt8($0 + 1) })
    private let lock = NSLock()
    private var inbound: [Data] = []
    private var waiter: CheckedContinuation<Data, Error>?
    private var closedFlag = false
    private var sent: [Data] = []
    private var decoder = FrameDecoder()
    private(set) var phonePublic: Data?
    private(set) var keys: PairingSessionKeys?
    private var sealer: FrameSealer?
    private var ackOpener: FrameOpener?

    var offer: PairingOffer { PairingOffer(sid: sid, macPublic: keypair.publicKey, addrs: ["127.0.0.1"], port: 1) }
    var closed: Bool { lock.withLock { closedFlag } }
    var connector: PairingConnector { { [self] _, _ in MacTransport(mac: self) } }

    /// Reads the client's HELLO and derives the Mac's keys.
    func readHello(from frames: [PairingFrame]) throws -> String {
        let hello = try #require(frames.first)
        let object = try JSONSerialization.jsonObject(with: hello.body) as! [String: Any]
        let pk = Data(base64URL: object["pk"] as! String)!
        phonePublic = pk
        let shared = try PairingCrypto.sharedSecret(privateKey: keypair.privateKey, peerPublic: pk)
        let derived = PairingCrypto.deriveSession(shared: shared, sid: sid, macPublic: keypair.publicKey, phonePublic: pk)
        keys = derived
        sealer = FrameSealer(key: derived.macToPhone, sid: sid, direction: .macToPhone)
        ackOpener = FrameOpener(key: derived.phoneToMac, sid: sid, direction: .phoneToMac)
        return derived.sas
    }

    func sentFrames() throws -> [PairingFrame] {
        let chunks = lock.withLock { sent }
        var d = FrameDecoder()
        return try chunks.flatMap { try d.push($0) }
    }

    func openAck(_ frame: PairingFrame) throws -> ImportCounts {
        var opener = try #require(ackOpener)
        let plain = try opener.open(type: frame.type, sealed: frame.body)
        return try JSONDecoder().decode(ImportCounts.self, from: plain)
    }

    func sealedFrame(type: UInt8, plaintext: Data) throws -> Data {
        var s = try #require(sealer)
        defer { sealer = s }
        return try encodeFrame(type: type, body: try s.seal(type: type, plaintext: plaintext))
    }

    func push(_ data: Data) {
        lock.lock()
        if let w = waiter { waiter = nil; lock.unlock(); w.resume(returning: data) } else { inbound.append(data); lock.unlock() }
    }

    func pushBundle(_ json: Data, chunk: Int = PairingLimits.chunkSize) throws {
        try push(sealedFrame(type: PairingFrameType.ready, plaintext: Data()))
        var offset = 0
        repeat {
            let end = min(offset + chunk, json.count)
            try push(sealedFrame(type: PairingFrameType.bundle, plaintext: Data([end >= json.count ? 1 : 0]) + json[offset..<end]))
            offset = end
        } while offset < json.count
    }

    fileprivate func recordSent(_ data: Data) { lock.withLock { sent.append(data) } }
    func markClosedExternally() { markClosed() }
    fileprivate func markClosed() {
        lock.lock()
        closedFlag = true
        let w = waiter
        waiter = nil
        lock.unlock()
        w?.resume(throwing: PairingError.connectionClosed)
    }

    fileprivate func next() async throws -> Data {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Data, Error>) in
            lock.lock()
            if !inbound.isEmpty { let d = inbound.removeFirst(); lock.unlock(); c.resume(returning: d) }
            else if closedFlag { lock.unlock(); c.resume(throwing: PairingError.connectionClosed) }
            else { waiter = c; lock.unlock() }
        }
    }
}

private struct MacTransport: PairingTransport {
    let mac: ScriptedMac
    func send(_ data: Data) async throws { mac.recordSent(data) }
    func receive() async throws -> Data { try await mac.next() }
    func close() { mac.markClosed() }
}

func sampleBundleData() throws -> Data {
    let c = try PairingFixtures.cases("pairing-bundle").first { $0.name == "full bundle" }!
    return try JSONEncoder().encode(c.input)
}

// The iPhone's half of the handshake, independent of the network: it speaks to a `PairingTransport`.
// connect() sends HELLO and returns the six-digit code; receiveBundle() waits for the Mac's approval and the sealed
// bundle; acknowledge() reports counts. Any failure closes the transport and leaves nothing behind.

import Foundation

public protocol PairingTransport: Sendable {
    func send(_ data: Data) async throws
    /// The next bytes from the Mac. Throws `PairingError.connectionClosed` at end of stream.
    func receive() async throws -> Data
    func close()
}

/// Opens a transport to the Mac, trying every address. The Network.framework version is `NetworkConnector`.
public typealias PairingConnector = @Sendable (_ addrs: [String], _ port: Int) async throws -> any PairingTransport

public struct ImportCounts: Codable, Hashable, Sendable {
    public var accounts = 0, signatures = 0, templates = 0, rules = 0, blockedSenders = 0

    public init(accounts: Int = 0, signatures: Int = 0, templates: Int = 0, rules: Int = 0, blockedSenders: Int = 0) {
        self.accounts = accounts
        self.signatures = signatures
        self.templates = templates
        self.rules = rules
        self.blockedSenders = blockedSenders
    }
}

public actor PairingClient {
    private let offer: PairingOffer
    private let deviceName: String
    private let connector: PairingConnector
    private let keypair: PairingKeypair
    private var transport: (any PairingTransport)?
    private var decoder = FrameDecoder()
    private var queue: [PairingFrame] = []
    private var opener: FrameOpener?
    private var sealer: FrameSealer?
    private var finished = false

    public init(offer: PairingOffer, deviceName: String, connector: @escaping PairingConnector, keypair: PairingKeypair = .generate()) {
        self.offer = offer
        self.deviceName = String(deviceName.prefix(64))
        self.connector = connector
        self.keypair = keypair
    }

    /// Connects, sends HELLO, derives the keys. Returns the code to compare with the Mac's.
    public func connect() async throws -> String {
        try await guarded {
            let transport = try await connector(offer.addrs, offer.port)
            self.transport = transport
            let shared = try PairingCrypto.sharedSecret(privateKey: keypair.privateKey, peerPublic: offer.macPublic)
            let keys = PairingCrypto.deriveSession(shared: shared, sid: offer.sid, macPublic: offer.macPublic, phonePublic: keypair.publicKey)
            opener = FrameOpener(key: keys.macToPhone, sid: offer.sid, direction: .macToPhone)
            sealer = FrameSealer(key: keys.phoneToMac, sid: offer.sid, direction: .phoneToMac)
            try await transport.send(try encodeFrame(type: PairingFrameType.hello, body: helloBody()))
            return keys.sas
        }
    }

    /// Waits for the Mac's approval (READY) and the bundle. Throws when the Mac cancels, the session expires or anything fails to verify.
    public func receiveBundle() async throws -> PairingBundle {
        try await guarded {
            let ready = try await nextFrame()
            guard ready.type == PairingFrameType.ready, try open(ready).isEmpty else { throw PairingError.unexpectedFrame }
            var json = Data()
            while true {
                let frame = try await nextFrame()
                guard frame.type == PairingFrameType.bundle else { throw PairingError.unexpectedFrame }
                let plain = try open(frame)
                guard let flag = plain.first, flag <= 1 else { throw PairingError.badFrame }
                json.append(plain.dropFirst())
                guard json.count <= PairingLimits.maxBundleBytes else { throw PairingError.bundleTooLarge }
                if flag == 1 { break }
            }
            return try PairingBundle.decode(json)
        }
    }

    /// Tells the Mac what was imported, then closes. The Mac records only the device name and date.
    public func acknowledge(_ counts: ImportCounts) async throws {
        try await guarded {
            guard var sealer, let transport else { throw PairingError.connectionClosed }
            let sealed = try sealer.seal(type: PairingFrameType.ack, plaintext: try JSONEncoder().encode(counts))
            self.sealer = sealer
            try await transport.send(try encodeFrame(type: PairingFrameType.ack, body: sealed))
        }
        close()
    }

    public func close() {
        finished = true
        transport?.close()
        transport = nil
        opener = nil
        sealer = nil
    }

    // MARK: Private

    private func helloBody() throws -> Data {
        try JSONSerialization.data(withJSONObject: ["v": PairingCrypto.protocolVersion, "sid": offer.sid.base64URL, "pk": keypair.publicKey.base64URL, "name": deviceName])
    }

    private func open(_ frame: PairingFrame) throws -> Data {
        guard var opener else { throw PairingError.connectionClosed }
        let plain = try opener.open(type: frame.type, sealed: frame.body)
        self.opener = opener
        return plain
    }

    private func nextFrame() async throws -> PairingFrame {
        while queue.isEmpty {
            guard let transport, !finished else { throw PairingError.connectionClosed }
            queue.append(contentsOf: try decoder.push(try await transport.receive()))
        }
        return queue.removeFirst()
    }

    /// Runs a step; on any error closes the transport so no key or socket outlives a failure.
    private func guarded<T>(_ step: () async throws -> T) async throws -> T {
        do {
            return try await step()
        } catch {
            close()
            throw error is PairingError ? error : (error is CancellationError ? error : PairingError.connectionClosed)
        }
    }
}

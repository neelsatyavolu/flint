// The QR payload: `flint://pair#<base64url(JSON)>` with { v, sid, pk, addrs, port }. The QR pins the Mac's public key.

import Foundation

public struct PairingOffer: Equatable, Sendable {
    public static let prefix = "flint://pair#"
    public static let maxAddrs = 3

    public let sid: Data
    public let macPublic: Data
    public let addrs: [String]
    public let port: Int

    public init(sid: Data, macPublic: Data, addrs: [String], port: Int) {
        self.sid = sid
        self.macPublic = macPublic
        self.addrs = addrs
        self.port = port
    }

    private struct Wire: Decodable {
        let v: Int
        let sid: String
        let pk: String
        let addrs: [String]
        let port: Int
    }

    /// Reads a scanned or opened `flint://pair#...` string. Throws `badQRCode` for anything else and `unsupportedVersion` for another major version.
    public static func parse(_ text: String) throws -> PairingOffer {
        guard text.hasPrefix(prefix), let json = Data(base64URL: String(text.dropFirst(prefix.count))),
              let wire = try? JSONDecoder().decode(Wire.self, from: json) else { throw PairingError.badQRCode }
        guard wire.v == PairingCrypto.protocolVersion else { throw wire.v > PairingCrypto.protocolVersion ? PairingError.unsupportedVersion : PairingError.badQRCode }
        guard let sid = Data(base64URL: wire.sid), sid.count == PairingCrypto.sidLength,
              let pk = Data(base64URL: wire.pk), pk.count == PairingCrypto.keyLength,
              (1...maxAddrs).contains(wire.addrs.count), wire.addrs.allSatisfy({ !$0.isEmpty && $0.count <= 45 }),
              (1...65535).contains(wire.port) else { throw PairingError.badQRCode }
        return PairingOffer(sid: sid, macPublic: pk, addrs: wire.addrs, port: wire.port)
    }

    /// The same string the Mac put in the QR. Used by tests.
    public var urlString: String {
        let object: [String: Any] = ["v": PairingCrypto.protocolVersion, "sid": sid.base64URL, "pk": macPublic.base64URL, "addrs": addrs, "port": port]
        let json = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
        return Self.prefix + json.base64URL
    }
}

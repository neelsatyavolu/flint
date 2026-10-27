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
              (1...maxAddrs).contains(wire.addrs.count), wire.addrs.allSatisfy({ $0.count <= 45 && isLocalHost($0) }),
              (1...65535).contains(wire.port) else { throw PairingError.badQRCode }
        return PairingOffer(sid: sid, macPublic: pk, addrs: wire.addrs, port: wire.port)
    }

    /// True for hosts that can only be on the local network: IPv4 private (10/8, 172.16/12, 192.168/16), link-local (169.254/16) and
    /// loopback, IPv6 link-local, unique-local and loopback literals, and `.local` names. A public name or address is refused, so a link
    /// from a web page or a mail cannot make this iPhone dial out to a server of someone else's choosing.
    public static func isLocalHost(_ host: String) -> Bool {
        let h = host.lowercased()
        if let octets = ipv4Octets(h) {
            switch (octets[0], octets[1]) {
            case (10, _), (127, _), (192, 168), (169, 254): return true
            case (172, 16...31): return true
            default: return false
            }
        }
        if h.contains(":") { return isLocalIPv6(h) }
        let labels = h.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, labels.last == "local" else { return false }
        return labels.allSatisfy { !$0.isEmpty && $0.count <= 63 && $0.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") } }
    }

    private static func ipv4Octets(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        let octets = parts.compactMap { $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) && !$0.isEmpty && $0.count <= 3 ? Int($0) : nil }
        return octets.count == 4 && octets.allSatisfy { $0 <= 255 } ? octets : nil
    }

    private static func isLocalIPv6(_ host: String) -> Bool {
        let bare = host.split(separator: "%", maxSplits: 1).first.map(String.init) ?? host
        guard bare.allSatisfy({ $0.isHexDigit || $0 == ":" }) else { return false }
        if bare == "::1" { return true }
        guard let first = bare.split(separator: ":", omittingEmptySubsequences: true).first, let high = UInt16(first, radix: 16), !bare.hasPrefix(":") else { return false }
        return (0xfe80...0xfebf).contains(high) || (0xfc00...0xfdff).contains(high)
    }

    /// The same string the Mac put in the QR. Used by tests.
    public var urlString: String {
        let object: [String: Any] = ["v": PairingCrypto.protocolVersion, "sid": sid.base64URL, "pk": macPublic.base64URL, "addrs": addrs, "port": port]
        let json = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
        return Self.prefix + json.base64URL
    }
}

// Which known provider hosts a domain's mail, judged by its MX records (track 2C). Port of `mxHostOf`.

import FlintModel
import Foundation

public struct MXRecord: Hashable, Sendable {
    public var exchange: String
    public var priority: Int

    public init(exchange: String, priority: Int) {
        self.exchange = exchange
        self.priority = priority
    }
}

public enum MXHost: String, Hashable, Sendable {
    case google, proton, microsoft, fastmail, zoho, icloud

    /// Name for messages ("handled by Fastmail"). Never used for Google.
    public var displayName: String {
        switch self {
        case .google: return "Google"
        case .proton: return "Proton Mail"
        case .microsoft: return "Microsoft 365"
        case .fastmail: return "Fastmail"
        case .zoho: return "Zoho Mail"
        case .icloud: return "iCloud Mail"
        }
    }
}

/// First match wins, in this order (Google before Proton, as on desktop).
private let mxPatterns: [(MXHost, [String])] = [
    (.google, ["google.com", "googlemail.com"]),
    (.proton, ["protonmail.ch", "proton.me"]),
    (.microsoft, ["outlook.com", "protection.outlook.com", "office365.us"]),
    (.fastmail, ["messagingengine.com"]),
    (.zoho, ["zoho.com", "zoho.eu"]),
    (.icloud, ["icloud.com", "me.com"]),
]

private func matches(_ host: String, suffix: String) -> Bool { host == suffix || host.hasSuffix("." + suffix) }

/// Null when DNS fails, the domain has no MX records, or none are recognized.
public func mxHost(of domain: String, resolveMX: @Sendable (String) async throws -> [MXRecord]) async -> MXHost? {
    guard let records = try? await resolveMX(domain) else { return nil }
    let hosts = records.map { record -> String in
        let h = record.exchange.lowercased()
        return h.hasSuffix(".") ? String(h.dropLast()) : h
    }
    return mxPatterns.first { _, suffixes in hosts.contains { h in suffixes.contains { matches(h, suffix: $0) } } }?.0
}

/// MX rdata: 2-byte priority, then an uncompressed domain name (what mDNSResponder hands to `DNSServiceQueryRecord`).
public func parseMXRecordData(_ data: Data) -> MXRecord? {
    let bytes = [UInt8](data)
    guard bytes.count >= 3 else { return nil }
    let priority = Int(bytes[0]) << 8 | Int(bytes[1])
    var labels: [String] = []
    var i = 2
    while i < bytes.count {
        let length = Int(bytes[i])
        i += 1
        if length == 0 { return MXRecord(exchange: labels.joined(separator: "."), priority: priority) }
        guard length < 64, i + length <= bytes.count, let label = String(bytes: bytes[i..<i + length], encoding: .utf8) else { return nil }
        labels.append(label)
        i += length
    }
    return nil
}

import FlintModel
import Foundation

/// Loads pairing-vectors.json and pairing-bundle.json (copies made by apps/ios/scripts/sync-fixtures.sh).
enum PairingFixtures {
    static func load(_ name: String) throws -> [String: JSONValue] {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"),
              case .object(let root) = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)) else { throw FlintError(.notFound, "fixture \(name).json") }
        return root
    }

    static func cases(_ name: String) throws -> [(name: String, input: JSONValue, expect: JSONValue)] {
        try (load(name)["cases"]?.array ?? []).map { c in
            let o = c.object ?? [:]
            return (o["name"]?.string ?? "", o["input"] ?? .null, o["expect"] ?? .null)
        }
    }
}

extension Data {
    init(hex: String) {
        self.init()
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            append(UInt8(hex[index..<next], radix: 16)!)
            index = next
        }
    }

    var hex: String { map { String(format: "%02x", $0) }.joined() }
}

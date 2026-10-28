import Foundation
import FlintModel

/// Loads the shared JSON fixtures (`packages/core/fixtures`, copied by `apps/ios/scripts/sync-fixtures.sh`).
struct ClassifyFixtureFile {
    struct Case {
        let name: String
        let input: [String: JSONValue]
        let expect: JSONValue
    }

    let version: Int
    let meta: [String: JSONValue]
    let cases: [Case]

    static func load(_ name: String) throws -> ClassifyFixtureFile {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else {
            throw FlintError(.notFound, "fixture \(name).json")
        }
        guard case .object(let root) = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)),
              case .object(let meta)? = root["meta"], case .number(let version)? = meta["version"],
              case .array(let raw)? = root["cases"]
        else { throw FlintError(.invalid, "fixture \(name).json shape") }
        let cases: [Case] = try raw.map {
            guard case .object(let c) = $0, case .string(let n)? = c["name"], case .object(let input)? = c["input"], let expect = c["expect"]
            else { throw FlintError(.invalid, "fixture \(name).json case") }
            return Case(name: n, input: input, expect: expect)
        }
        return ClassifyFixtureFile(version: Int(version), meta: meta, cases: cases)
    }
}

extension JSONValue {
    var string: String? { if case .string(let s) = self { return s } else { return nil } }
    var bool: Bool? { if case .bool(let b) = self { return b } else { return nil } }
    var int: Int? { if case .number(let n) = self { return Int(n) } else { return nil } }
    var array: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
    var object: [String: JSONValue]? { if case .object(let o) = self { return o } else { return nil } }
    var isNull: Bool { if case .null = self { return true } else { return false } }

    /// Decode into any Codable model type (Rule, RuleAction, Address...).
    func decoded<T: Decodable>(_ type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONEncoder().encode(self))
    }

    var stringMap: [String: String] {
        (object ?? [:]).compactMapValues(\.string)
    }
}

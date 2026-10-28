import FlintModel
import Testing
import Foundation

/// One case of a shared fixture file (packages/core/fixtures, copied by scripts/sync-fixtures.sh).
struct StoreFixtureCase: Sendable, CustomTestStringConvertible, Decodable {
    var name: String
    var input: [String: JSONValue]
    var expect: JSONValue
    var testDescription: String { name }
}

enum StoreFixtures {
    private struct File: Decodable { var cases: [StoreFixtureCase] }

    static func cases(_ name: String, where keep: (StoreFixtureCase) -> Bool = { _ in true }) -> [StoreFixtureCase] {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data)
        else { return [] }
        return file.cases.filter(keep)
    }

    /// The search fixture's day numbers were generated on a machine in this zone (local midnight of the named day).
    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return c
    }()

    /// Calendar day of an epoch-ms value as YYYY-MM-DD in the fixture zone, or nil.
    static func dayString(_ ms: Int?) -> String? {
        guard let ms else { return nil }
        let c = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: Double(ms) / 1000))
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

extension JSONValue {
    var fxString: String? { if case .string(let s) = self { return s } else { return nil } }
    var fxInt: Int? { if case .number(let n) = self { return Int(n) } else { return nil } }
    var fxBool: Bool? { if case .bool(let b) = self { return b } else { return nil } }
    var fxArray: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
    var fxObject: [String: JSONValue]? { if case .object(let o) = self { return o } else { return nil } }
    var fxIsNull: Bool { if case .null = self { return true } else { return false } }
    static func fxNumber(_ n: Int?) -> JSONValue { n.map { .number(Double($0)) } ?? .null }
    static func fxText(_ s: String?) -> JSONValue { s.map { .string($0) } ?? .null }
    static func fxFlag(_ b: Bool?) -> JSONValue { b.map { .bool($0) } ?? .null }
}

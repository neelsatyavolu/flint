import Testing
import FlintModel
import Foundation

/// Loader for the shared JSON fixtures used by the FlintHTML and FlintReceipts suites.
/// Files are copied by apps/ios/scripts/sync-fixtures.sh; never edit the copies.
struct FixtureCase: Sendable, CustomTestStringConvertible {
    var name: String
    var input: FX
    var expect: FX
    var testDescription: String { name }
}

struct FixtureFile: Sendable {
    var meta: FX
    var cases: [FixtureCase]
    var root: FX

    func cases(fn: String) -> [FixtureCase] { cases.filter { $0.input["fn"]?.fxString == fn } }
}

enum FixtureError: Error { case missing(String) }

func loadFixtureFile(_ name: String) -> FixtureFile {
    do {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else { throw FixtureError.missing(name) }
        let root = FX(try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)))
        let cases = (root["cases"]?.fxArray ?? []).compactMap { c -> FixtureCase? in
            guard let name = c["name"]?.fxString, let input = c["input"], let expect = c["expect"] else { return nil }
            return FixtureCase(name: name, input: input, expect: expect)
        }
        return FixtureFile(meta: root["meta"] ?? FX(.null), cases: cases, root: root)
    } catch {
        fatalError("Fixture \(name).json could not be loaded: \(error)")
    }
}

/// Read-only view over a fixture's JSON, so these suites do not extend `JSONValue` (other suites do, with other names).
struct FX: Sendable {
    let raw: JSONValue

    init(_ raw: JSONValue) { self.raw = raw }

    subscript(key: String) -> FX? {
        if case .object(let o) = raw, let v = o[key] { return FX(v) }
        return nil
    }
    var fxString: String? { if case .string(let s) = raw { return s }; return nil }
    var fxBool: Bool? { if case .bool(let b) = raw { return b }; return nil }
    var fxInt: Int? { if case .number(let n) = raw { return Int(n) }; return nil }
    var fxArray: [FX]? { if case .array(let a) = raw { return a.map(FX.init) }; return nil }
    var fxStrings: [String] { (fxArray ?? []).compactMap(\.fxString) }
    var fxStringMap: [String: String] {
        guard case .object(let o) = raw else { return [:] }
        return o.compactMapValues { if case .string(let s) = $0 { return s }; return nil }
    }
}

/// Regex built from JavaScript source and flags (ASCII-only constructs in the fixtures, so ICU is equivalent).
func fixtureRegex(_ pattern: String, flags: String) -> NSRegularExpression {
    var options: NSRegularExpression.Options = []
    if flags.contains("i") { options.insert(.caseInsensitive) }
    return try! NSRegularExpression(pattern: pattern, options: options)
}

func regexMatches(_ regex: NSRegularExpression, _ text: String) -> Bool {
    regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
}

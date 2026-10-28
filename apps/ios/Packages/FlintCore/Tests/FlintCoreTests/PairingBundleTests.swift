import FlintModel
import Foundation
import Testing
@testable import FlintPairing

@Suite("Pairing bundle")
struct PairingBundleTests {
    private func json(_ value: JSONValue) throws -> Data { try JSONEncoder().encode(value) }
    private func sample() throws -> JSONValue {
        try PairingFixtures.cases("pairing-bundle").first { $0.name == "full bundle" }!.input
    }

    @Test func decodesAndReEncodesEveryFixtureCase() throws {
        let cases = try PairingFixtures.cases("pairing-bundle")
        #expect(cases.count >= 10)
        for c in cases {
            let e = c.expect.object!
            let data = try json(c.input)
            if e["valid"]?.bool == true {
                let bundle = try PairingBundle.decode(data)
                let again = try JSONDecoder().decode(JSONValue.self, from: bundle.encoded())
                #expect(again == e["canonical"], "\(c.name)")
            } else {
                #expect(throws: PairingError.self, "\(c.name)") { try PairingBundle.decode(data) }
            }
        }
    }

    @Test func mapsAnUnknownMajorVersionToItsOwnError() throws {
        let c = try PairingFixtures.cases("pairing-bundle").first { $0.name == "unknown major version" }!
        #expect(throws: PairingError.unsupportedVersion) { try PairingBundle.decode(try json(c.input)) }
    }

    @Test func dropsUnknownKeysSoATokenCannotSurvive() throws {
        let c = try PairingFixtures.cases("pairing-bundle").first { $0.name == "unknown keys are dropped" }!
        let text = String(decoding: try PairingBundle.decode(try json(c.input)).encoded(), as: UTF8.self)
        #expect(!text.contains("must-not-survive"))
        #expect(!text.lowercased().contains("token"))
    }

    @Test func googleAccountsHaveNoSecretField() throws {
        let allowed = try PairingFixtures.load("pairing-bundle")["allowedKeys"]!.object!
        let bundle = try PairingBundle.decode(try json(try sample()))
        let google = try #require(bundle.accounts.first { $0.authKind == .oauthGoogle })
        #expect(google.needsGoogleSignIn)
        let object = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(google)) as? [String: Any])
        #expect(Set(object.keys).isSubset(of: Set(allowed["googleAccount"]!.array!.compactMap(\.string))))
        #expect(object["password"] == nil)
        let top = try #require(try JSONSerialization.jsonObject(with: bundle.encoded()) as? [String: Any])
        #expect(Set(top.keys) == Set(allowed["bundle"]!.array!.compactMap(\.string)))
        let accountKeys = Set(allowed["account"]!.array!.compactMap(\.string))
        for a in try #require(top["accounts"] as? [[String: Any]]) { #expect(Set(a.keys).isSubset(of: accountKeys)) }
    }

    @Test func rejectsOversizeInputAndGarbage() throws {
        #expect(throws: PairingError.bundleTooLarge) { try PairingBundle.decode(Data(count: PairingLimits.maxBundleBytes + 1)) }
        #expect(throws: PairingError.malformedBundle) { try PairingBundle.decode(Data("{".utf8)) }
        #expect(throws: PairingError.malformedBundle) { try PairingBundle.decode(Data()) }
    }

    @Test func enforcesArrayCaps() throws {
        guard case .object(var root) = try sample(), case .array(let blocked) = root["blockedSenders"]! else { return }
        root["blockedSenders"] = .array(Array(repeating: blocked[0], count: BundleLimits.blockedSenders + 1))
        #expect(throws: PairingError.malformedBundle) { try PairingBundle.decode(try json(.object(root))) }
        root["blockedSenders"] = .array(Array(repeating: blocked[0], count: BundleLimits.blockedSenders))
        _ = try PairingBundle.decode(try json(.object(root)))
    }

    @Test func buildsASettingsPatchWithOnlyTheKeysTheMacSent() throws {
        let bundle = try PairingBundle.decode(try json(try sample()))
        let patch = try bundle.settings.patch(includeReceipts: true)
        guard case .object(let o) = patch else { Issue.record("not an object"); return }
        #expect(Set(o.keys) == ["compose", "sync", "inbox", "receipts", "appearance", "notifications"])
        #expect(o["compose"] == .object(["undoSendSeconds": .number(10)]))
        #expect(o["sync"] == .object(["initialDays": .number(90)]))
        #expect(try BundleSettings().patch() == .object([:]))
    }

    @Test func passwordRowsAreMarked() throws {
        let bundle = try PairingBundle.decode(try json(try sample()))
        let imap = bundle.accounts[0]
        #expect(!imap.needsPassword && imap.password == "app-password-sample")
        var stripped = imap
        stripped.password = nil
        #expect(stripped.needsPassword)
        #expect(imap.server.imapHost == "imap.example.com")
    }
}

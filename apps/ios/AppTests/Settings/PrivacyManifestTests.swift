@testable import Flint
import Foundation
import Testing

/// The app's privacy manifest has to say what the App Store Connect answers say (docs/ios/RELEASING.md, "App Privacy answers").
@Suite("Privacy manifest")
struct PrivacyManifestTests {
    private func manifest() throws -> [String: Any] {
        let url = try #require(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"))
        let data = try Data(contentsOf: url)
        return try #require(try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
    }

    @Test("no tracking and no tracking domains")
    func noTracking() throws {
        let manifest = try manifest()
        #expect(manifest["NSPrivacyTracking"] as? Bool == false)
        #expect((manifest["NSPrivacyTrackingDomains"] as? [String]) == [])
    }

    @Test("receipts data is declared: device ID and product interaction, for app functionality, not linked, not tracking")
    func declaredData() throws {
        let entries = try #require(try manifest()["NSPrivacyCollectedDataTypes"] as? [[String: Any]])
        let types = Set(entries.compactMap { $0["NSPrivacyCollectedDataType"] as? String })
        #expect(types == ["NSPrivacyCollectedDataTypeDeviceID", "NSPrivacyCollectedDataTypeProductInteraction"])
        for entry in entries {
            #expect(entry["NSPrivacyCollectedDataTypeLinked"] as? Bool == false)
            #expect(entry["NSPrivacyCollectedDataTypeTracking"] as? Bool == false)
            #expect((entry["NSPrivacyCollectedDataTypePurposes"] as? [String]) == ["NSPrivacyCollectedDataTypePurposeAppFunctionality"])
        }
    }

    @Test("UserDefaults is the only required-reason API, with reason CA92.1")
    func requiredReason() throws {
        let apis = try #require(try manifest()["NSPrivacyAccessedAPITypes"] as? [[String: Any]])
        #expect(apis.count == 1)
        #expect(apis.first?["NSPrivacyAccessedAPIType"] as? String == "NSPrivacyAccessedAPICategoryUserDefaults")
        #expect((apis.first?["NSPrivacyAccessedAPITypeReasons"] as? [String]) == ["CA92.1"])
    }
}

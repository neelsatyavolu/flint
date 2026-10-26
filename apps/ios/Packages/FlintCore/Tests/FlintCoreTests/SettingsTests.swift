import Foundation
import Testing
@testable import FlintModel

@Suite("Settings")
struct SettingsTests {
    /// DEFAULT_SETTINGS from packages/core/src/store/settings.ts, minus the `null` provider/model keys Swift omits.
    static let desktopDefaults = #"""
    {"appearance":{"layout":"split","theme":"system","avatars":"everywhere","senderLogos":true,"senderPhotos":false,"emailAppearance":"match","previewLines":1,"density":"comfortable","accountColors":true},
     "inbox":{"focused":true,"sort":"newest","markReadOnOpen":"instant","afterArchive":"next","blockTrackers":true,"remoteImages":"known_senders"},
     "compose":{"undoSendSeconds":10,"defaultSignatureByAccount":{},"defaultReplySignatureByAccount":{},"plainTextOnly":false},
     "receipts":{"enabled":true,"defaultOn":true,"endpoint":"","notifyOnOpen":true},
     "notifications":{"enabled":true,"scope":"people","sound":true,"soundName":"default","preview":"sender_subject","badge":"unified_unread","disabledAccounts":[]},
     "ai":{"enabled":true,"autoSummarize":true,"smartReplies":true,"autoCategorize":false,"writingStyle":"","replyLanguage":""},
     "agents":{"enabled":true,"modify":"allow","send":"ask"},
     "sync":{"initialDays":90,"bodiesForRecentDays":14},
     "google":{"clientId":"","clientSecret":""},
     "updates":{"mode":"ask"},
     "codes":{"enabled":true,"notify":true,"autoCopy":false}}
    """#

    @Test func defaultsMatchDesktop() throws {
        let ours = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(Settings.default))
        let theirs = try JSONDecoder().decode(JSONValue.self, from: Data(Self.desktopDefaults.utf8))
        #expect(ours == theirs)
    }

    @Test func loadFillsMissingKeysWithDefaults() throws {
        let stored = Data(#"{"appearance":{"theme":"dark"},"sync":{"initialDays":30}}"#.utf8)
        let settings = try Settings.load(from: stored)
        #expect(settings.appearance.theme == .dark)
        #expect(settings.appearance.density == .comfortable)
        #expect(settings.sync.initialDays == 30)
        #expect(settings.sync.bodiesForRecentDays == 14)
        #expect(settings.codes.enabled)
    }

    @Test func loadAcceptsDesktopNulls() throws {
        let stored = Data(#"{"ai":{"provider":null,"model":null},"compose":{"defaultSignatureByAccount":{"a1":3,"a2":null}}}"#.utf8)
        let settings = try Settings.load(from: stored)
        #expect(settings.ai.provider == nil)
        #expect(settings.compose.defaultSignatureByAccount["a1"] == .some(3))
        #expect(settings.compose.defaultSignatureByAccount["a2"] == .some(nil))
        #expect(settings.compose.defaultSignatureByAccount["a3"] == nil)
    }

    @Test func mergingPatchReturnsNewValue() throws {
        let base = Settings.default
        let patch = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"inbox":{"focused":false},"notifications":{"disabledAccounts":["a1"]}}"#.utf8))
        let next = try base.merging(patch)
        #expect(base.inbox.focused)
        #expect(!next.inbox.focused)
        #expect(next.notifications.disabledAccounts == ["a1"])
        #expect(next.inbox.sort == .newest)
    }

    @Test func mergingRejectsBadValues() throws {
        let patch = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"appearance":{"theme":"purple"}}"#.utf8))
        #expect(throws: DecodingError.self) { try Settings.default.merging(patch) }
    }

    @Test func settingsRoundTrip() throws {
        var settings = Settings.default
        settings.compose.defaultSignatureByAccount = ["a": 1, "b": nil]
        settings.google.builtIn = true
        let again = try JSONDecoder().decode(Settings.self, from: JSONEncoder().encode(settings))
        #expect(again == settings)
    }
}

@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("Settings logic")
struct SettingsLogicTests {
    private let time = FlintTime(calendar: Calendar(identifier: .gregorian), locale: Locale(identifier: "en_US"))

    @Test("account status lines follow the sync state")
    func status() {
        let now = Date()
        func status(_ sync: SyncStatus?, enabled: Bool = true) -> AccountStatus { AccountStatus.describe(sync: sync, enabled: enabled, now: now, time: time) }
        #expect(status(nil, enabled: false).text == "Paused")
        #expect(status(nil).text == "Waiting to sync")
        #expect(status(SyncStatus(accountId: "a", state: .syncing, progress: SyncProgress(done: 3, total: 10))).text == "Syncing 3 of 10")
        #expect(status(SyncStatus(accountId: "a", state: .syncing)).text == "Syncing")
        let expired = status(SyncStatus(accountId: "a", state: .authError))
        #expect(expired.needsSignIn && expired.tone == .error && expired.text == "Sign-in expired")
        #expect(status(SyncStatus(accountId: "a", state: .error, error: "Server said no")).text == "Server said no")
        #expect(status(SyncStatus(accountId: "a", state: .offline)).tone == .warn)
        #expect(status(SyncStatus(accountId: "a", state: .idle)).text == "Up to date")
        let synced = status(SyncStatus(accountId: "a", state: .idle, lastSyncAt: Int(now.timeIntervalSince1970 * 1000)))
        #expect(synced.tone == .ok && synced.text.hasPrefix("Synced "))
        #expect(!synced.needsSignIn)
    }

    @Test("alias checks reject bad, own and repeated addresses and normalise good ones")
    func aliases() {
        #expect(AliasCheck.check("  Maya@Example.COM ", own: "other@example.com", existing: []) == .ok("maya@example.com"))
        #expect(AliasCheck.check("maya", own: "o@e.com", existing: []) == .failure("Enter a full email address."))
        #expect(AliasCheck.check("a@b", own: "o@e.com", existing: []) == .failure("Enter a full email address."))
        #expect(AliasCheck.check("a b@c.com", own: "o@e.com", existing: []) == .failure("Enter a full email address."))
        #expect(AliasCheck.check("O@E.com", own: "o@e.com", existing: []) == .failure("That is already the account address."))
        #expect(AliasCheck.check("x@y.com", own: "o@e.com", existing: ["X@y.com"]) == .failure("That alias is already added."))
    }

    @Test("the palette has eight distinct colors and selection ignores case")
    func palette() {
        #expect(AccountPalette.hex.count == 8)
        #expect(Set(AccountPalette.hex).count == 8)
        #expect(AccountPalette.isSelected("#b6706b", current: "#B6706B"))
        #expect(!AccountPalette.isSelected("#b6706b", current: nil))
        #expect(!AccountPalette.isSelected("#b6706b", current: "#ae794c"))
    }

    @Test("a settings patch is a one-key nested object and merges into Settings")
    func patch() throws {
        let patch = SettingsPatch.object("compose", "undoSendSeconds", .number(20))
        #expect(patch == .object(["compose": .object(["undoSendSeconds": .number(20)])]))
        let merged = try Settings.default.merging(patch)
        #expect(merged.compose.undoSendSeconds == 20)
        #expect(merged.inbox == Settings.default.inbox)
        let enumPatch = SettingsPatch.object("inbox", "remoteImages", .string(Settings.Inbox.RemoteImages.knownSenders.rawValue))
        #expect(try Settings.default.merging(enumPatch).inbox.remoteImages == .knownSenders)
    }

    @Test("undo send choices match the desktop and read plainly")
    func undo() {
        #expect(SettingsChoices.undoSendSeconds == [0, 5, 10, 20, 30])
        #expect(SettingsChoices.syncLabel(90) == "90 days" && SettingsChoices.syncLabel(365) == "1 year" && SettingsChoices.syncLabel(730) == "2 years")
        #expect(SettingsChoices.undoLabel(0) == "Off")
        #expect(SettingsChoices.undoLabel(10) == "10 seconds")
    }

    @Test("choosing a swipe action moves it first, keeps the rest and saves where the inbox reads")
    func swipes() throws {
        let name = "flint.tests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let start = SwipeConfiguration.load(from: defaults)
        #expect(start == .standard)
        let moved = start.choosing(.trash, for: .leading)
        #expect(moved.leading == [.trash, .read, .pin])
        #expect(moved.trailing == start.trailing)
        let first = start.choosing(.snooze, for: .trailing)
        #expect(first.trailing == [.snooze, .archive, .trash])
        let cleared = moved.choosing(nil, for: .leading)
        #expect(cleared.primary(.leading) == nil)
        cleared.save(to: defaults)
        #expect(SwipeConfiguration.load(from: defaults) == cleared)
        #expect(SwipeConfiguration.choiceLabel(nil) == "Nothing")
    }
}

@Suite("Rule draft")
struct RuleDraftTests {
    @Test("a new rule needs a name and a value")
    func validation() {
        var draft = RuleDraft()
        var issues = draft.validate()
        #expect(issues.name == "Name the rule." && issues.conditions == ["Enter a value."] && !issues.isEmpty)
        draft.name = "Receipts"
        draft.conditions = [RuleCondition(field: .from, op: .contains, value: "billing@")]
        #expect(draft.validate().isEmpty)
        draft.conditions = []
        draft.actions = []
        issues = draft.validate()
        #expect(issues.general == ["Add at least one condition.", "Add at least one action."])
    }

    @Test("patterns must compile and folder actions need a folder")
    func patternsAndFolders() {
        var draft = RuleDraft()
        draft.name = "R"
        draft.conditions = [RuleCondition(field: .subject, op: .matches, value: "([unclosed")]
        draft.actions = [.move(folderPath: "  ")]
        let issues = draft.validate()
        #expect(issues.conditions == ["That pattern isn't valid."])
        #expect(issues.actions == ["Enter a folder."])
        draft.conditions = [RuleCondition(field: .subject, op: .matches, value: "^invoice \\d+")]
        draft.actions = [.move(folderPath: "Receipts")]
        #expect(draft.validate().isEmpty)
    }

    @Test("changing the field keeps a valid operator and clears the value for has attachment")
    func fieldChange() {
        let c = RuleCondition(field: .from, op: .endsWith, value: "x")
        #expect(RuleDraft.with(field: .subject, on: c) == RuleCondition(field: .subject, op: .endsWith, value: "x"))
        #expect(RuleDraft.with(field: .hasAttachment, on: c) == RuleCondition(field: .hasAttachment, op: .isTrue, value: ""))
        let back = RuleDraft.with(field: .to, on: RuleCondition(field: .hasAttachment, op: .isTrue))
        #expect(back.op == .contains)
        #expect(RuleDraft.operators(for: .hasAttachment) == [.isTrue])
    }

    @Test("actions start with sensible parameters and report their kind")
    func actions() {
        for kind in RuleDraft.ActionKind.allCases { #expect(RuleDraft.kind(of: RuleDraft.newAction(kind)) == kind) }
        #expect(RuleDraft.newAction(.category) == .category(.newsletters))
        #expect(RuleDraft.newAction(.notify) == .notify(enabled: false))
    }

    @Test("the summary reads like the desktop")
    func summary() {
        let rule = Rule(
            id: 1, name: "n", match: .any,
            conditions: [RuleCondition(field: .from, op: .contains, value: "boss"), RuleCondition(field: .hasAttachment, op: .isTrue)],
            actions: [.move(folderPath: "Work"), .category(.people), .notify(enabled: false), .pin])
        #expect(RuleDraft.summary(of: rule) == "If from contains boss or has attachment: move to Work, file as people, no notification, pin")
    }

    @Test("a draft round-trips to a rule and a new draft saves with id 0")
    func roundTrip() {
        var draft = RuleDraft(sortOrder: 4)
        draft.name = " Receipts "
        #expect(draft.rule().id == 0 && draft.rule().name == "Receipts" && draft.rule().sortOrder == 4)
        let saved = Rule(id: 9, name: "Z", conditions: [RuleDraft.newCondition()], actions: [.archive], sortOrder: 2)
        #expect(RuleDraft(saved).rule() == saved)
    }

    @Test("reorder swaps neighbours, handles equal order and stops at the edges")
    func reorder() {
        let rules = [
            Rule(id: 1, name: "a", conditions: [], actions: [], sortOrder: 1),
            Rule(id: 2, name: "b", conditions: [], actions: [], sortOrder: 2),
            Rule(id: 3, name: "c", conditions: [], actions: [], sortOrder: 3),
        ]
        let down = RuleDraft.reorder(rules, id: 1, by: 1)
        #expect(down?.map(\.id) == [1, 2] && down?.map(\.sortOrder) == [2, 1])
        #expect(RuleDraft.reorder(rules, id: 1, by: -1) == nil)
        #expect(RuleDraft.reorder(rules, id: 3, by: 1) == nil)
        let tied = [Rule(id: 1, name: "a", conditions: [], actions: [], sortOrder: 0), Rule(id: 2, name: "b", conditions: [], actions: [], sortOrder: 0)]
        let swapped = RuleDraft.reorder(tied, id: 2, by: -1)
        #expect(swapped.map { $0.map(\.sortOrder) } != nil)
        #expect(Set(swapped?.map(\.sortOrder) ?? []).count == 2)
    }
}

@Suite("Signature text")
struct SignatureTextTests {
    @Test("HTML becomes readable text")
    func plain() {
        let html = "<div>Maya Okafor</div><div>Northwind &amp; Co<br>Head of design</div><style>p{color:red}</style><p>&lt;maya@example.com&gt;</p>"
        #expect(SignatureText.plain(fromHTML: html) == "Maya Okafor\nNorthwind & Co\nHead of design\n<maya@example.com>")
    }

    @Test("text becomes escaped HTML with blank lines kept")
    func html() {
        #expect(SignatureText.html(fromPlain: "A & B\n\n<c>") == "<div>A &amp; B</div><div><br></div><div>&lt;c&gt;</div>")
        #expect(SignatureText.html(fromPlain: "  \n ") == "")
    }

    @Test("untouched text keeps the stored HTML, edited text replaces it")
    func preservesFormatting() {
        let original = "<div><b>Maya</b></div><div style=\"color:#555\">Designer</div>"
        var draft = SignatureDraft(Signature(id: 3, name: "Work", html: original, accountIds: ["a"], defaultNew: true))
        #expect(draft.text == "Maya\nDesigner" && draft.signature().html == original)
        draft.text = "Maya\nLead designer"
        #expect(draft.signature().html == "<div>Maya</div><div>Lead designer</div>")
        #expect(draft.signature().id == 3 && draft.signature().defaultNew && draft.signature().accountIds == ["a"])
    }

    @Test("drafts need a name and a body to save, and a new draft has id 0")
    func canSave() {
        var draft = SignatureDraft()
        #expect(!draft.canSave && draft.signature().id == 0)
        draft.name = "Work"
        #expect(!draft.canSave)
        draft.text = "Maya"
        #expect(draft.canSave)
        var template = TemplateDraft()
        template.name = "Intro"
        template.subject = " Hello "
        template.text = "Hi there"
        #expect(template.canSave)
        #expect(template.template().subject == "Hello" && template.template().html == "<div>Hi there</div>")
    }
}

@Suite("Device and privacy copy")
@MainActor
struct DeviceCopyTests {
    @Test("copy names the device it runs on")
    func deviceName() {
        #expect(ThisDevice.name(isPad: true) == "iPad")
        #expect(ThisDevice.name(isPad: false) == "iPhone")
    }

    @Test("privacy copy names the other contacts and makes no claim of none")
    func contacts() {
        let text = PrivacyCopy.contacts
        #expect(text.contains("Google") && text.contains("Thunderbird") && text.contains("receipts"))
        #expect(!text.contains("nothing else") && !text.contains("only to"))
        #expect(!PrivacyCopy.cached.contains("nothing else"))
    }
}

@Suite("License catalog")
struct LicenseCatalogTests {
    @Test("every shipped project has a copyright line and its license text")
    func complete() throws {
        let catalog = try #require(LicenseCatalog.load(bundle: Bundle(for: BundleToken.self)) ?? LicenseCatalog.load())
        #expect(catalog.items.count >= 20)
        for item in catalog.items {
            #expect(!item.copyright.isEmpty, "\(item.name) has no copyright")
            #expect(catalog.text(for: item).count > 500, "\(item.name) has no license text")
        }
    }

    @Test("the direct dependencies, fonts and icons are listed with their own license")
    func direct() throws {
        let catalog = try #require(LicenseCatalog.load(bundle: Bundle(for: BundleToken.self)) ?? LicenseCatalog.load())
        #expect(catalog.text(for: try #require(catalog.item(named: "SwiftSoup"))).contains("Jonathan Hedley"))
        #expect(catalog.text(for: try #require(catalog.item(named: "GRDB.swift"))).contains("Gwendal"))
        #expect(catalog.text(for: try #require(catalog.item(named: "SwiftMail"))).contains("Redistribution"))
        #expect(catalog.text(for: try #require(catalog.item(named: "swift-nio"))).contains("Apache License"))
        #expect(catalog.text(for: try #require(catalog.item(named: "Geist"))).contains("SIL OPEN FONT LICENSE"))
        #expect(catalog.text(for: try #require(catalog.item(named: "Lucide icons"))).contains("ISC License"))
    }
}

private final class BundleToken {}

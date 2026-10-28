@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("Settings library", .serialized)
@MainActor
struct SettingsLibraryTests {
    private func waitFor(_ condition: @MainActor () -> Bool) async -> Bool {
        for _ in 0..<80 {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return condition()
    }

    @Test("signatures and templates save, edit and delete through the service")
    func signaturesAndTemplates() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let library = SettingsLibrary(model: app.model)
        await library.load()
        #expect(library.isLoaded && library.loadError == nil)

        var draft = SignatureDraft()
        draft.name = "Work"
        draft.text = "Maya Okafor\nDesign"
        draft.defaultNew = true
        #expect(await library.save(draft.signature()))
        let saved = try #require(library.signatures.first { $0.name == "Work" })
        #expect(saved.id > 0 && saved.defaultNew && saved.html == "<div>Maya Okafor</div><div>Design</div>")

        var edit = SignatureDraft(saved)
        edit.name = "Studio"
        #expect(await library.save(edit.signature()))
        #expect(library.signatures.map(\.name) == ["Studio"])
        #expect(await library.deleteSignature(id: saved.id))
        #expect(library.signatures.isEmpty)

        var template = TemplateDraft()
        template.name = "Intro"
        template.subject = "Hello"
        template.text = "Hi,\nNice to meet you."
        #expect(await library.save(template.template()))
        let stored = try #require(library.templates.first)
        #expect(stored.subject == "Hello" && stored.html.contains("Nice to meet you."))
        #expect(await library.deleteTemplate(id: stored.id))
        #expect(library.templates.isEmpty)
    }

    @Test("rules save, reorder, toggle and delete; a bad pattern is refused with a toast")
    func rules() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let library = SettingsLibrary(model: app.model)
        await library.load()

        for (index, name) in ["First", "Second"].enumerated() {
            var draft = RuleDraft(sortOrder: index + 1)
            draft.name = name
            draft.conditions = [RuleCondition(field: .from, op: .contains, value: name.lowercased())]
            #expect(await library.save(draft.rule()))
        }
        #expect(library.rules.map(\.name) == ["First", "Second"])
        let second = try #require(library.rules.last)
        await library.moveRule(id: second.id, by: -1)
        #expect(library.rules.map(\.name) == ["Second", "First"])

        await library.setRule(id: second.id, enabled: false)
        #expect(library.rules.first { $0.id == second.id }?.enabled == false)

        var bad = RuleDraft(sortOrder: 9)
        bad.name = "Bad"
        bad.conditions = [RuleCondition(field: .subject, op: .matches, value: "([")]
        #expect(await library.save(bad.rule()) == false)
        #expect(app.model.toasts.current?.kind == .error)
        #expect(library.rules.count == 2)

        #expect(await library.deleteRule(id: second.id))
        #expect(library.rules.map(\.name) == ["First"])
    }

    @Test("blocked senders list and unblock")
    func blocked() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let library = SettingsLibrary(model: app.model)
        await app.model.blockSender("spam@junk.example")
        await library.load()
        #expect(library.blocked.map(\.pattern).contains("spam@junk.example"))
        await library.unblock("spam@junk.example")
        #expect(!library.blocked.map(\.pattern).contains("spam@junk.example"))
    }

    @Test("setting bindings write patches and read the stored value back")
    func bindings() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let model = app.model
        let focused = model.boolSetting({ $0.inbox.focused }, section: "inbox", key: "focused")
        #expect(focused.wrappedValue == true)
        focused.wrappedValue = false
        #expect(await waitFor { model.settings?.inbox.focused == false })
        #expect(focused.wrappedValue == false)

        let remote = model.choiceSetting({ $0.inbox.remoteImages }, section: "inbox", key: "remoteImages")
        remote.wrappedValue = .never
        #expect(await waitFor { model.settings?.inbox.remoteImages == .never })

        let undo = model.settingBinding({ $0.compose.undoSendSeconds }, section: "compose", key: "undoSendSeconds", encode: { .number(Double($0)) })
        undo.wrappedValue = 30
        #expect(await waitFor { model.settings?.compose.undoSendSeconds == 30 })
        // A write to one key leaves its neighbours alone.
        #expect(model.settings?.inbox.focused == false && model.settings?.compose.plainTextOnly == false)
    }

    @Test("account color, aliases and unified switch update; removing an account leaves the others")
    func accounts() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let model = app.model
        let account = try #require(model.accounts.first { $0.authKind == .password })
        _ = try await model.updateAccount(id: account.id, AccountPatch(color: AccountPalette.hex[3], aliases: ["me@alias.example"], showInUnified: false))
        #expect(await waitFor { model.account(account.id)?.color == AccountPalette.hex[3] })
        let updated = try #require(model.account(account.id))
        #expect(updated.aliases == ["me@alias.example"] && updated.showInUnified == false)

        let before = model.accounts.count
        try await model.removeAccount(id: account.id)
        #expect(await waitFor { model.accounts.count == before - 1 })
        #expect(model.account(account.id) == nil)
    }
}

@testable import Flint
import FlintModel
import FlintService
import Foundation
import SwiftUI
import Testing

/// The composer's view model over the demo mailbox, through the real service.
@Suite("Composer: view model", .serialized)
@MainActor
struct ComposerViewModelTests {
    private final class Closed { var count = 0 }

    private func open(_ app: SeededApp, _ request: ComposeRequest = .start(.new())) async -> (ComposerViewModel, Closed) {
        let closed = Closed()
        let vm = ComposerViewModel(model: app.model, dismiss: { closed.count += 1 })
        await vm.load(request)
        return (vm, closed)
    }

    private func firstMessageId(_ app: SeededApp, subject: String) async throws -> MessageRowID {
        let item = try #require(try await app.thread(subject: subject))
        return try #require(try await app.model.threadDetail(item.id).messages.last?.id)
    }

    @Test("a new draft opens on the first account with an empty body")
    func newDraft() async throws {
        let app = try await SeededApp.make()
        let (vm, _) = await open(app)
        #expect(vm.phase == .ready)
        #expect(vm.mode == .new && vm.title == "New message")
        #expect(vm.fields.from == app.model.accounts.first?.email)
        #expect(vm.fields.to.isEmpty && RichTextHTML.isEmpty(vm.body))
        #expect(vm.fromOptions.count >= 3)
        await vm.discard()
        await app.tearDown()
    }

    @Test("edits are saved to the draft")
    func autosave() async throws {
        let app = try await SeededApp.make()
        let (vm, _) = await open(app)
        let id = try #require(vm.draft?.id)
        vm.edit { $0.subject = "Lunch"; $0.to = [Address(name: "Ann", address: "ann@example.com")] }
        vm.body = AttributedString("See you at noon")
        vm.bodyChanged()
        #expect(await vm.finish())
        let saved = try await app.model.draft(id: id)
        #expect(saved.subject == "Lunch")
        #expect(saved.to.map(\.address) == ["ann@example.com"])
        #expect(saved.html.contains("See you at noon"))
        await app.tearDown()
    }

    @Test("a reply fills recipient, subject and the collapsed quote, and reopens with the same text")
    func reply() async throws {
        let app = try await SeededApp.make()
        let messageId = try await firstMessageId(app, subject: "Q4 roadmap notes")
        let (vm, _) = await open(app, .start(.reply(messageId: messageId, html: "<div>Thanks</div>")))
        #expect(vm.mode == .reply && vm.title == "Reply")
        #expect(vm.fields.to.map(\.address) == ["daniel.reyes@northwind.example"])
        #expect(vm.fields.subject.hasPrefix("Re:"))
        #expect(!vm.quotedHTML.isEmpty)
        #expect(String(vm.body.characters) == "Thanks")
        let id = try #require(vm.draft?.id)
        #expect(await vm.finish())
        let (again, _) = await open(app, .resume(draftId: id))
        #expect(String(again.body.characters) == "Thanks" && again.fields.to == vm.fields.to)
        await app.tearDown()
    }

    @Test("forward carries the subject and leaves recipients empty")
    func forward() async throws {
        let app = try await SeededApp.make()
        let messageId = try await firstMessageId(app, subject: "Q4 roadmap notes")
        let (vm, _) = await open(app, .start(.forward(messageId: messageId)))
        #expect(vm.mode == .forward && vm.fields.subject.hasPrefix("Fwd:") && vm.fields.to.isEmpty)
        await app.tearDown()
    }

    @Test("the default signature is added one line below the body, and a From change swaps it")
    func signatures() async throws {
        let app = try await SeededApp.make()
        let service = try app.model.requireService()
        let google = try #require(app.model.accounts.first { $0.id == "demo-google" })
        let work = try #require(app.model.accounts.first { $0.id == "demo-work" })
        _ = try await service.saveSignature(Signature(id: 0, name: "Plain", html: "Maya", accountIds: [google.id], defaultNew: true))
        _ = try await service.saveSignature(Signature(id: 0, name: "Work", html: "Maya at Northwind", accountIds: [work.id], defaultNew: true))
        let (vm, _) = await open(app, .start(.new(accountId: google.id)))
        #expect(vm.signature?.name == "Plain")
        #expect(vm.draft?.html.contains("data-signature-id") == true)
        vm.chooseFrom(ComposerFromOption(accountId: work.id, address: work.email, accountName: work.name))
        #expect(vm.signature?.name == "Work" && vm.fields.accountId == work.id && vm.fields.from == work.email)
        vm.chooseSignature(nil)
        vm.body = AttributedString("Hello")
        vm.bodyChanged()
        let id = try #require(vm.draft?.id)
        #expect(await vm.finish())
        let saved = try await app.model.draft(id: id)
        #expect(saved.html == "<div>Hello</div>" && saved.signatureId == nil && saved.accountId == work.id)
        vm.chooseSignature(vm.availableSignatures.first)
        #expect(SignatureRules.compose(body: "<div>Hello</div>", signature: vm.signature).contains("<br><div class=\"flint_signature\""))
        await app.tearDown()
    }

    @Test("send needs a recipient, asks about a missing subject, then goes out and closes")
    func send() async throws {
        let app = try await SeededApp.make()
        let (vm, closed) = await open(app)
        await vm.requestSend()
        #expect(vm.problem == "Add at least one recipient.")
        vm.edit { $0.to = [Address(address: "ann@example.com")] }
        #expect(vm.problem == nil)
        vm.body = AttributedString("Hello")
        await vm.requestSend()
        #expect(vm.confirm == .noSubject && closed.count == 0)
        await vm.confirmSend()
        #expect(vm.confirm == nil && closed.count == 1)
        #expect(app.model.toasts.current?.message.hasPrefix("Sending in") == true)
        #expect(app.model.toasts.current?.countdown != nil)
        await app.tearDown()
    }

    @Test("a body that mentions an attachment asks before sending without one")
    func attachmentPrompt() async throws {
        let app = try await SeededApp.make()
        let (vm, closed) = await open(app)
        vm.edit { $0.to = [Address(address: "ann@example.com")]; $0.subject = "Deck" }
        vm.body = AttributedString("I attached the deck.")
        await vm.requestSend()
        #expect(vm.confirm == .noAttachment && closed.count == 0)
        vm.dismissConfirm()
        #expect(vm.confirm == nil)
        await app.tearDown()
    }

    @Test("send later schedules the draft and says when")
    func schedule() async throws {
        let app = try await SeededApp.make()
        let (vm, closed) = await open(app)
        vm.edit { $0.to = [Address(address: "ann@example.com")]; $0.subject = "Later" }
        let at = EpochMs(Date().addingTimeInterval(3 * 3600).timeIntervalSince1970 * 1000)
        await vm.requestSend(sendAt: at)
        #expect(closed.count == 1)
        #expect(app.model.toasts.current?.message.hasPrefix("Scheduled for") == true)
        let scheduled = try await app.model.requireService().listScheduled()
        #expect(scheduled.contains { $0.subject == "Later" && $0.sendAt == at })
        await app.tearDown()
    }

    @Test("undo send reopens the draft with what was written")
    func undo() async throws {
        let app = try await SeededApp.make()
        let (vm, _) = await open(app)
        vm.edit { $0.to = [Address(address: "ann@example.com")]; $0.subject = "Oops" }
        vm.body = AttributedString("Draft text")
        vm.bodyChanged()
        await vm.requestSend()
        await app.model.toasts.performUndo()
        guard case .compose(.resume(let draftId)) = app.model.presented else {
            Issue.record("undo did not reopen the composer")
            return
        }
        let (again, _) = await open(app, .resume(draftId: draftId))
        #expect(again.fields.subject == "Oops" && String(again.body.characters) == "Draft text")
        await app.tearDown()
    }

    @Test("closing a blank draft deletes it, closing a written one keeps it")
    func closing() async throws {
        let app = try await SeededApp.make()
        let (blank, closedBlank) = await open(app)
        let blankId = try #require(blank.draft?.id)
        await blank.close()
        #expect(closedBlank.count == 1)
        await #expect(throws: (any Error).self) { _ = try await app.model.draft(id: blankId) }

        let (written, _) = await open(app)
        let id = try #require(written.draft?.id)
        written.edit { $0.subject = "Keep me" }
        await written.close()
        #expect(try await app.model.draft(id: id).subject == "Keep me")

        let (gone, closedGone) = await open(app)
        gone.edit { $0.subject = "Throw away" }
        let goneId = try #require(gone.draft?.id)
        await gone.discard()
        #expect(closedGone.count == 1)
        await #expect(throws: (any Error).self) { _ = try await app.model.draft(id: goneId) }
        await app.tearDown()
    }

    @Test("files are attached and removed through the service")
    func attachments() async throws {
        let app = try await SeededApp.make()
        let (vm, _) = await open(app)
        await vm.attach(data: Data("hello".utf8), filename: "notes.txt")
        #expect(vm.fields.attachments.map(\.filename) == ["notes.txt"])
        #expect(vm.problem == nil)
        let attachment = try #require(vm.fields.attachments.first)
        await vm.removeAttachment(attachment)
        #expect(vm.fields.attachments.isEmpty)
        await app.tearDown()
    }

    @Test("the read receipt toggle is saved with the draft")
    func receipt() async throws {
        let app = try await SeededApp.make()
        let (vm, _) = await open(app)
        let before = vm.fields.track
        vm.toggleTrack()
        #expect(vm.fields.track == !before)
        let id = try #require(vm.draft?.id)
        vm.edit { $0.subject = "Receipts" }
        #expect(await vm.finish())
        #expect(try await app.model.draft(id: id).track == !before)
        await app.tearDown()
    }

    private static let richHTML = "<div style=\"color:red\">Hello</div><table><tr><td><img src=\"cid:logo\"></td></tr></table>"

    @Test("a draft written elsewhere keeps its HTML when only a field changes")
    func richDraftSurvives() async throws {
        let app = try await SeededApp.make()
        let (first, _) = await open(app)
        let id = try #require(first.draft?.id)
        _ = try await app.model.updateDraft(id: id, DraftPatch(html: Self.richHTML))
        let (vm, _) = await open(app, .resume(draftId: id))
        #expect(vm.isBodyLocked && !vm.isBlank)
        vm.edit { $0.subject = "Changed" }
        vm.body = AttributedString("typed over it")
        vm.bodyChanged()
        #expect(await vm.finish())
        let saved = try await app.model.draft(id: id)
        #expect(saved.subject == "Changed" && saved.html == Self.richHTML)
        await app.tearDown()
    }

    @Test("flattening a rich draft is the person's choice and then saves the editor text")
    func flattenOnRequest() async throws {
        let app = try await SeededApp.make()
        let (first, _) = await open(app)
        let id = try #require(first.draft?.id)
        _ = try await app.model.updateDraft(id: id, DraftPatch(html: Self.richHTML))
        let (vm, _) = await open(app, .resume(draftId: id))
        vm.editBodyAsPlainText()
        #expect(!vm.isBodyLocked)
        vm.body = AttributedString("plain now")
        vm.bodyChanged()
        #expect(await vm.finish())
        #expect(try await app.model.draft(id: id).html == "<div>plain now</div>")
        await app.tearDown()
    }

    @Test("which HTML the editor can hold")
    func fidelity() {
        #expect(DraftHTMLFidelity.isLossless("<div>Hi <b>there</b></div><ul><li>a</li></ul><br>"))
        #expect(DraftHTMLFidelity.isLossless("<div><a href=\"https://x.example\">x</a></div>"))
        #expect(!DraftHTMLFidelity.isLossless("<div style=\"color:red\">x</div>"))
        #expect(!DraftHTMLFidelity.isLossless("<p>x</p><img src=\"cid:a\">"))
        #expect(!DraftHTMLFidelity.isLossless("<table><tr><td>x</td></tr></table>"))
        #expect(!DraftHTMLFidelity.isLossless("<div><a href=\"https://x.example\" target=\"_blank\">x</a></div>"))
    }

    @Test("a template fills an empty subject and lands in the body, and keeps a typed subject")
    func templates() async throws {
        let app = try await SeededApp.make()
        let service = try app.model.requireService()
        _ = try await service.saveTemplate(Template(id: 0, name: "Intro", subject: "Nice to meet you", html: "<div>Hello <b>there</b></div>"))
        let (vm, _) = await open(app)
        let template = try #require(vm.templates.first)
        vm.insert(template)
        #expect(vm.fields.subject == "Nice to meet you")
        #expect(String(vm.body.characters) == "Hello there")
        vm.edit { $0.subject = "Mine" }
        vm.insert(template)
        #expect(vm.fields.subject == "Mine")
        #expect(String(vm.body.characters).hasSuffix("Hello there") && String(vm.body.characters).count > 11)
        await vm.discard()
        await app.tearDown()
    }

    @Test("a template inserted into a draft written elsewhere shows on screen and is added once")
    func templateInLockedDraft() async throws {
        let app = try await SeededApp.make()
        let service = try app.model.requireService()
        _ = try await service.saveTemplate(Template(id: 0, name: "Intro", subject: "", html: "<div>Hello <b>there</b></div>"))
        let (first, _) = await open(app)
        let id = try #require(first.draft?.id)
        _ = try await app.model.updateDraft(id: id, DraftPatch(html: Self.richHTML))
        let (vm, _) = await open(app, .resume(draftId: id))
        let template = try #require(vm.templates.first)
        vm.insert(template)
        #expect(String(vm.body.characters).contains("Hello there"))
        #expect(vm.isBodyLocked)
        #expect(await vm.finish())
        let html = try await app.model.draft(id: id).html
        #expect(html.hasPrefix(Self.richHTML) && html.components(separatedBy: "there").count == 2)
        await app.tearDown()
    }
}

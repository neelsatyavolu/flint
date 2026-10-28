import FlintMail
import FlintModel
import FlintStore
import Foundation
import Testing
@testable import FlintService

private func inbox() -> ThreadQuery { ThreadQuery(view: .inbox) }

@Suite("Service: attachments")
struct ServiceAttachmentTests {
    @Test func attachmentsAreServedAsBytesAndAsAShareableFile() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        let tree = BodyPart(number: "", type: "multipart", subtype: "mixed", children: [
            BodyPart(number: "1", type: "text", subtype: "plain"),
            BodyPart(number: "2", type: "application", subtype: "pdf", disposition: "attachment", filename: "../invoice.pdf", size: 4),
        ])
        await rig.fake.deliver(mailTestEnvelope("with file", ageDays: 1, structure: tree), parts: ["1": Data("b".utf8), "2": Data("%PDF".utf8)], to: "INBOX")
        try await rig.service.syncNow()
        let id = try #require(try await rig.service.listThreads(inbox()).items.first?.id)
        let message = try #require(try await rig.service.thread(id: id).messages.first)
        let attachment = try #require(message.attachments.first)

        #expect(try await rig.service.attachmentData(attachment.id) == Data("%PDF".utf8))
        let file = try await rig.service.attachmentFile(attachment.id)
        #expect(try Data(contentsOf: file) == Data("%PDF".utf8))
        #expect(file.path.hasPrefix(rig.directory.appendingPathComponent("cache/opened").path))
        #expect(file.lastPathComponent.contains("invoice.pdf"))
        #expect(!file.lastPathComponent.contains("/"))
        await #expect(throws: FlintError.self) { _ = try await rig.service.attachmentData(424_242) }
        await #expect(throws: FlintError.self) { _ = try await rig.service.attachmentFile(424_242) }
    }

    @Test func aForwardCarriesTheOriginalsAttachmentsIntoTheDraft() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        let tree = BodyPart(number: "", type: "multipart", subtype: "mixed", children: [
            BodyPart(number: "1", type: "text", subtype: "plain"),
            BodyPart(number: "2", type: "application", subtype: "pdf", disposition: "attachment", filename: "plan.pdf", size: 4),
        ])
        await rig.fake.deliver(mailTestEnvelope("Plan", ageDays: 1, structure: tree), parts: ["1": Data("b".utf8), "2": Data("%PDF".utf8)], to: "INBOX")
        try await rig.service.syncNow()
        let id = try #require(try await rig.service.listThreads(inbox()).items.first?.id)
        let message = try #require(try await rig.service.thread(id: id).messages.first)
        let draft = try await rig.service.createDraft(.forward(messageId: message.id))
        let carried = try #require(draft.attachments.first)
        #expect(carried.filename == "plan.pdf")
        #expect(try Data(contentsOf: URL(fileURLWithPath: carried.path)) == Data("%PDF".utf8))
        // The copy is the draft's own: deleting the draft takes it along.
        try await rig.service.deleteDraft(id: draft.id)
        #expect(!FileManager.default.fileExists(atPath: carried.path))
    }
}

@Suite("Service: streams and accounts")
struct ServiceSurfaceTests {
    @Test func everyStreamYieldsItsCurrentValueFirst() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let account = try await rig.addAccount()
        await rig.deliver("hello", ageDays: 1)
        try await rig.service.syncNow()
        let thread = try #require(try await rig.service.listThreads(inbox()).items.first)
        _ = try await rig.service.createDraft(.new(accountId: account.id, to: [Address(address: "bo@example.org")], subject: "Draft one"))

        #expect(await serviceAwait(rig.service.thread(thread.id)) { $0.messages.count == 1 } != nil)
        #expect(await serviceAwait(rig.service.drafts()) { $0.map(\.subject) == ["Draft one"] } != nil)
        #expect(await serviceAwait(rig.service.scheduled()) { $0.isEmpty } != nil)
        #expect(await serviceAwait(rig.service.tracked()) { $0.isEmpty } != nil)
        #expect(await serviceAwait(rig.service.codes()) { $0.isEmpty } != nil)
        #expect(await serviceAwait(rig.service.syncStatus()) { $0.count == 1 } != nil)
        #expect(await serviceAwait(rig.service.sidebar()) { $0.counts.drafts == 1 } != nil)
    }

    @Test func theScheduledStreamFollowsASendThroughItsStates() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let account = try await rig.addAccount()
        let draft = try await rig.service.createDraft(.new(accountId: account.id, to: [Address(address: "bo@example.org")], subject: "Later"))
        let pending = Task { await serviceAwait(rig.service.scheduled()) { $0.count == 1 } }
        try await Task.sleep(for: .milliseconds(100))
        _ = try await rig.service.sendDraft(id: draft.id, sendAt: rig.clock.now + 3_600_000)
        #expect(await pending.value?.first?.subject == "Later")
    }

    @Test func autoconfigKnowsGmailAndAdvisesAgainstProton() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let gmail = try await rig.service.autoconfig(email: "someone@gmail.com")
        #expect(gmail?.server.imapHost == "imap.gmail.com")
        #expect(await rig.service.autoconfigAdvice(email: "someone@gmail.com") == nil)
        #expect(await rig.service.autoconfigAdvice(email: "someone@proton.me") == .needsProtonBridge)
        #expect(try await rig.service.autoconfig(email: "nobody") == nil)
    }

    @Test func closingTheGoogleSignInPageIsACancellationNotAFailure() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        do {
            _ = try await rig.service.addGoogleAccount()
            Issue.record("expected the sign-in to be cancelled")
        } catch let error as FlintError {
            #expect(error.isGoogleSignInCancelled)
        }
        #expect(try await rig.service.listAccounts().isEmpty)
    }

    @Test func theGoogleClientIdCanBeOverriddenInSettings() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let initial = await rig.service.core.auth.currentClientId()
        #expect(initial == FlintServiceConfiguration.builtInGoogleClientId)
        try await rig.service.updateSettings(patch: .object(["google": .object(["clientId": .string(" custom.apps.googleusercontent.com ")])]))
        #expect(await rig.service.core.auth.currentClientId() == "custom.apps.googleusercontent.com")
    }

    @Test func anAccountCanBeRenamedAndDisabled() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let account = try await rig.addAccount()
        let renamed = try await rig.service.updateAccount(id: account.id, AccountPatch(name: "Work", enabled: false))
        #expect(renamed.name == "Work")
        #expect(!renamed.enabled)
        // A disabled account is not synced, but actions on its mail still reach the server through an idle session.
        try await rig.service.syncNow()
        #expect(await rig.fake.connectCount == 1)
        await #expect(throws: FlintError.self) { _ = try await rig.service.updateAccount(id: account.id, AccountPatch(server: mailTestServer)) }
    }

    @Test func aSignInFailureReportedByTheCredentialLayerBecomesSignInAgain() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let account = try await rig.addAccount()
        await rig.service.core.hooks.authFailed(accountID: account.id, message: "refresh failed")
        let status = try #require(try await rig.service.syncStatuses().first)
        #expect(status.state == .authError)
        #expect(status.error == "Sign in again.")
        #expect(rig.log.count { if case .sync(let s) = $0 { return s.state == .authError } else { return false } } == 1)
        await rig.service.core.hooks.authFailed(accountID: account.id, message: "again")
        #expect(rig.log.count { if case .sync(let s) = $0 { return s.state == .authError } else { return false } } == 1)
    }
}

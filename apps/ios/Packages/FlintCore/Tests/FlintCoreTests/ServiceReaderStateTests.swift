import FlintMail
import FlintModel
import FlintStore
import Foundation
import Testing
@testable import FlintService

@Suite("Service: reader image policy and place")
struct ServiceReaderStateTests {
    private func deliverHTML(_ rig: ServiceRig, subject: String, html: String) async {
        let part = BodyPart(number: "1", type: "text", subtype: "html", parameters: ["charset": "utf-8"], encoding: "7bit", size: html.utf8.count)
        let envelope = mailTestEnvelope(subject, ageDays: 1, structure: part)
        await rig.fake.deliver(envelope, parts: ["1": Data(html.utf8)], to: "INBOX")
    }

    private func firstThread(_ rig: ServiceRig) async throws -> ThreadDetail {
        let id = try #require(try await rig.service.listThreads(ThreadQuery(view: .inbox)).items.first?.id)
        return try await rig.service.thread(id: id)
    }

    @Test func mailWithoutRemoteImagesStillKeepsTheImageBlockingPolicy() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await deliverHTML(rig, subject: "Plain html", html: "<p>Hello there</p>")
        try await rig.service.syncNow()
        let message = try #require(try await firstThread(rig).messages.first)
        #expect(message.html != nil)
        #expect(!message.hasRemoteImages)
        // The sanitizer found nothing, but the web view's rule list must still block images: only the person or the sender policy lifts it.
        #expect(message.remoteImages == .blocked)
    }

    @Test func mailWithRemoteImagesIsFlaggedAndStaysBlockedUntilAllowed() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await deliverHTML(rig, subject: "Promo", html: "<p>Hi</p><img src=\"https://cdn.example.com/a.png\" width=\"40\" height=\"40\">")
        try await rig.service.syncNow()
        let message = try #require(try await firstThread(rig).messages.first)
        #expect(message.hasRemoteImages)
        #expect(message.remoteImages == .blocked)
        let allowed = try await rig.service.allowRemoteImages(messageId: message.id, always: false)
        #expect(allowed.remoteImages == .allowed)
        #expect(allowed.hasRemoteImages)
    }

    @Test func theThreadSaysWhereItIsSoArchiveFollowsTheConversationNotTheList() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("Lunch?", ageDays: 1)
        try await rig.service.syncNow()
        let id = try #require(try await rig.service.listThreads(ThreadQuery(view: .inbox)).items.first?.id)
        #expect(try await rig.service.thread(id: id).place == .inbox)

        _ = try await rig.service.archive([id])
        #expect(try await rig.service.thread(id: id).place == .archive)

        _ = try await rig.service.moveToInbox([id])
        #expect(try await rig.service.thread(id: id).place == .inbox)

        _ = try await rig.service.trash([id])
        #expect(try await rig.service.thread(id: id).place == .trash)
    }
}

@Suite("Thread place")
struct ThreadPlaceTests {
    @Test func inboxWinsAndSentMailDoesNotCount() {
        #expect(ThreadPlace.resolve(memberRoles: [[.inbox]]) == .inbox)
        #expect(ThreadPlace.resolve(memberRoles: [[.archive], [.sent]]) == .archive)
        #expect(ThreadPlace.resolve(memberRoles: [[.sent]]) == .inbox)
        #expect(ThreadPlace.resolve(memberRoles: [[.drafts], [.all, .sent]]) == .inbox)
        #expect(ThreadPlace.resolve(memberRoles: [[.all], [.all, .inbox]]) == .inbox)
    }

    @Test func otherFoldersMapToTheirPlace() {
        #expect(ThreadPlace.resolve(memberRoles: [[.spam]]) == .spam)
        #expect(ThreadPlace.resolve(memberRoles: [[.trash]]) == .trash)
        #expect(ThreadPlace.resolve(memberRoles: [[.all]]) == .archive)
        #expect(ThreadPlace.resolve(memberRoles: [[nil]]) == .folder)
        #expect(ThreadPlace.resolve(memberRoles: [[.all, nil]]) == .archive)
        #expect(ThreadPlace.resolve(memberRoles: []) == .inbox)
    }
}

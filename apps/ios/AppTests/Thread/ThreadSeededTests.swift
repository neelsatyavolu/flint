@testable import Flint
import FlintModel
import Foundation
import Testing

@MainActor
@Suite("Thread over the demo mailbox")
struct ThreadSeededTests {
    @Test("view model opens the newest message and keeps one card per message id")
    func opens() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let item = try #require(try await app.thread(subject: "Q4 roadmap notes"))
        let detail = try await app.model.threadDetail(item.id)
        let vm = ThreadModel()
        vm.apply(detail)
        #expect(vm.expanded.contains(try #require(detail.messages.last).id))
        #expect(Set(detail.messages.map(\.id)).count == detail.messages.count)
        #expect(Set(detail.messages.compactMap(\.messageId)).count == detail.messages.compactMap(\.messageId).count)
        #expect(ThreadLogic.replyTarget(vm.messages) != nil)
        // The person's fold survives a refresh.
        let last = try #require(detail.messages.last).id
        vm.toggle(last)
        vm.apply(detail)
        #expect(!vm.expanded.contains(last))
    }

    @Test("tracked send carries a receipt the row can describe")
    func receipt() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let sent = try await app.model.listThreads(ThreadQuery(view: .sent, limit: 50)).items
        let item = try #require(sent.first { $0.subject == "Flat viewing on Saturday" })
        let detail = try await app.model.threadDetail(item.id)
        let receipt = try #require(detail.messages.compactMap(\.receipt).first)
        #expect(!ReceiptText.summary(receipt).isEmpty)
        #expect(!ReceiptText.tracked(receipt).isEmpty)
    }

    @Test("newsletter html has remote images blocked until loaded")
    func images() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let items = try await app.model.listThreads(ThreadQuery(view: .inbox, focused: false, category: .newsletters, limit: 50)).items
        let item = try #require(items.first { $0.subject.hasPrefix("Quarterly Maker") })
        let detail = try await app.model.threadDetail(item.id)
        let message = try #require(detail.messages.first { $0.html != nil })
        #expect(message.remoteImages == .blocked)
        #expect(message.hasTrackers)
        let loaded = try await app.model.allowRemoteImages(messageId: message.id, always: false)
        #expect(loaded.remoteImages == .allowed)
        let vm = ThreadModel()
        vm.apply(detail)
        vm.setOverride(loaded)
        #expect(vm.shown(message).remoteImages == .allowed)
    }

    @Test("reply routes through the composer")
    func reply() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let item = try #require(try await app.thread(subject: "Q4 roadmap notes"))
        let detail = try await app.model.threadDetail(item.id)
        let target = try #require(ThreadLogic.replyTarget(detail.messages))
        app.model.startCompose(ThreadLogic.draftInit(.replyAll, messageId: target.id))
        #expect(app.model.presented == .compose(.start(.replyAll(messageId: target.id))))
    }
}

@MainActor
@Suite("Thread view model")
struct ThreadModelTests {
    @Test("link routing opens, asks, or composes")
    func links() {
        let vm = ThreadModel()
        #expect(vm.route(href: "mailto:a@b.com", text: "") == "a@b.com")
        #expect(vm.route(href: "https://example.com", text: "Read") == nil)
        #expect(vm.safariURL?.host == "example.com")
        vm.safariURL = nil
        #expect(vm.route(href: "https://evil.net", text: "bank.com") == nil)
        #expect(vm.safariURL == nil)
        #expect(vm.linkPrompt?.shown == "bank.com")
        vm.confirmLink()
        #expect(vm.safariURL?.host == "evil.net")
        #expect(vm.linkPrompt == nil)
    }

    @Test("queued sends over a minute away are scheduled")
    func queued() {
        let soon = QueuedReply(ScheduledSend(id: 1, draftId: 1, sendAt: 10_000, createdAt: 0))
        let later = QueuedReply(ScheduledSend(id: 2, draftId: 2, sendAt: 3_600_000, createdAt: 0))
        #expect(!soon.isScheduled)
        #expect(later.isScheduled)
    }
}

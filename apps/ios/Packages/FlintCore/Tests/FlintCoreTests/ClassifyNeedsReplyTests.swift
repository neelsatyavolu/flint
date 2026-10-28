import Foundation
import Testing
import FlintModel
@testable import FlintClassify

@Suite("Classify: needs reply and recategorize plan")
struct ClassifyNeedsReplyTests {
    static let now = 1_793_000_000_000

    private func brief(id: Int = 1, date: Int? = nil, address: String = "ana@x.com", text: String = "Hi, are you free Thursday?", fromMe: Bool = false, answered: Bool = false) -> ThreadBrief {
        ThreadBrief(threadId: id, subject: "Plan", date: date ?? Self.now - 3_600_000, from: Address(name: "Ana", address: address), lastText: text, unreadCount: 1, messageCount: 2, lastFromMe: fromMe, answered: answered)
    }

    @Test func reasons() {
        #expect(NeedsReply.replyReason("Are you free Thursday?") == .question)
        #expect(NeedsReply.replyReason("See https://x.com/a?b=1 for details.") == nil)
        #expect(NeedsReply.replyReason("> did you see this?\nThanks for the note.") == nil)
        #expect(NeedsReply.replyReason("Please confirm the time by tomorrow.") == .request)
        #expect(NeedsReply.replyReason("Let me know what works.") == .request)
        #expect(NeedsReply.replyReason("Thanks, got it. See you then.") == nil)
        #expect(NeedsReply.replyReason("   ") == nil)
        #expect(NeedsReply.replyReason("ご都合はいかがですか?") == .question) // a trailing ASCII ? counts, as in JS
        #expect(NeedsReply.replyReason("ご都合はいかがですか？") == nil) // full-width ？ is not matched, as in JS
        #expect(NeedsReply.replyReason("Ça va? Peux-tu confirmer?") == .question)
    }

    @Test func windowIsFirst700Chars() {
        let text = String(repeating: "a", count: 700) + " are you free?"
        #expect(NeedsReply.replyReason(text) == nil)
    }

    @Test func detect() {
        #expect(NeedsReply.detect([brief()], now: Self.now).map(\.threadId) == [1])
        #expect(NeedsReply.detect([brief(fromMe: true), brief(id: 2, answered: true)], now: Self.now).isEmpty)
        #expect(NeedsReply.detect([brief(id: 3, address: "no-reply@x.com"), brief(id: 4, date: Self.now - 20 * 86_400_000)], now: Self.now).isEmpty)
        let many = (0..<12).map { brief(id: $0 + 1, date: Self.now - $0 * 60_000) }
        let out = NeedsReply.detect(many, now: Self.now, max: 5)
        #expect(out.count == 5)
        #expect(out.first?.threadId == 1)
    }

    @Test func recategorizePlan() {
        #expect(RecategorizePlan.isStale(storedVersion: nil))
        #expect(RecategorizePlan.isStale(storedVersion: categorizerVersion - 1))
        #expect(!RecategorizePlan.isStale(storedVersion: categorizerVersion))

        let rows = [
            RecategorizeRow(messageId: 1, threadId: 10, subject: "Hi", from: Address(address: "carla@example.com"), headers: [:], category: nil),
            RecategorizeRow(messageId: 2, threadId: 10, subject: "Hi", from: Address(address: "noreply@example.com"), headers: [:], category: .people),
            RecategorizeRow(messageId: 3, threadId: 11, subject: "Hi", from: Address(address: "noreply@example.com"), headers: [:], category: .notifications),
            RecategorizeRow(messageId: 4, threadId: 12, subject: "Hi", from: Address(address: "ME@x.com"), headers: [:], category: .newsletters),
            RecategorizeRow(messageId: 5, threadId: 13, subject: "Hi", from: Address(address: "bot@known.com"), headers: ["precedence": "bulk"], category: .notifications),
        ]
        let plan = RecategorizePlan.make(rows: rows, ownAddresses: ["me@x.com"], knownContacts: ["bot@known.com"])
        // 1: nil category is filled in; 2: people -> notifications; 3: unchanged; 4: own mail skipped; 5: known contact -> people.
        #expect(plan.changes.map(\.messageId) == [1, 2, 5])
        #expect(plan.changes.map(\.category) == [.people, .notifications, .people])
        #expect(plan.touchedThreads == [10, 13])
        #expect(plan.changed == 3)
    }
}

@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("Demo seed", .serialized)
@MainActor
struct DemoSeedTests {
    @Test("builds three accounts: one Google, two IMAP")
    func accounts() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        #expect(app.model.phase == .ready)
        #expect(app.model.accounts.count == 3)
        #expect(app.model.accounts.filter { $0.authKind == .oauthGoogle }.count == 1)
        #expect(app.model.accounts.filter { $0.authKind == .password && $0.provider == .imap }.count == 2)
        #expect(app.model.accounts.allSatisfy { $0.email.contains("example.com") || $0.email.hasSuffix(".example") })
    }

    @Test("the sidebar is reachable from AppModel with unread counts and shared lists")
    func sidebar() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let sidebar = try #require(app.model.sidebar)
        #expect(sidebar.accounts.count == 3)
        #expect(sidebar.counts.inbox > 5)
        #expect(sidebar.counts.pinned >= 2)
        #expect(sidebar.counts.drafts >= 2)
        #expect(sidebar.counts.snoozed >= 1)
        #expect(sidebar.counts.scheduled >= 1)
        #expect(sidebar.accounts.allSatisfy { $0.folders.contains { $0.role == .inbox } })
    }

    @Test("about forty conversations across people, notifications and newsletters, unread and read")
    func volumeAndMix() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let inbox = try await app.inboxThreads()
        let pinned = try await app.model.listThreads(ThreadQuery(view: .pinned, limit: 200)).items
        let sent = try await app.model.listThreads(ThreadQuery(view: .sent, limit: 200)).items
        let archived = try await app.model.listThreads(ThreadQuery(view: .archive, limit: 200)).items
        let trashed = try await app.model.listThreads(ThreadQuery(view: .trash, limit: 200)).items
        let snoozed = try await app.model.listThreads(ThreadQuery(view: .snoozed, limit: 200)).items
        let total = Set((inbox + pinned + sent + archived + trashed + snoozed).map(\.id)).count
        #expect((34...48).contains(total), "total threads \(total)")
        #expect(Set(inbox.map(\.category)) == [.people, .notifications, .newsletters])
        #expect(inbox.contains { $0.unreadCount > 0 })
        #expect(inbox.contains { $0.unreadCount == 0 })
    }

    @Test("pinned, snoozed, drafts and a scheduled send exist")
    func organisation() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let pinned = try await app.model.listThreads(ThreadQuery(view: .pinned, limit: 50)).items
        #expect(Set(pinned.map(\.subject)).isSuperset(of: ["Offsite logistics", "Sunday dinner?"]))
        let snoozed = try await app.model.listThreads(ThreadQuery(view: .snoozed, limit: 50)).items
        #expect(snoozed.map(\.subject).contains("Logo options v3"))
        let drafts = try await app.model.listThreads(ThreadQuery(view: .drafts, limit: 50)).items
        #expect(drafts.count >= 2)
        var scheduled: [ScheduledSend] = []
        for try await list in app.model.scheduled() { scheduled = list; break }
        #expect(scheduled.contains { $0.subject == "Send later copy, second pass" })
    }

    @Test("a verification code is detected from mail that arrives after the first sync")
    func code() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let item = try #require(try await app.thread(subject: "Your Pocket verification code"))
        #expect(item.verificationCode?.code == "482913")
        let recent = await (try app.model.requireService()).recentCodes()
        #expect(recent.contains { $0.code == "482913" })
    }

    @Test("tracked sends carry read receipts: one opened, one replied, one only sent")
    func receipts() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let tracked = try await app.model.requireService().listTracked(limit: 20)
        #expect(tracked.count == 2)
        let flat = try #require(tracked.first { $0.subject == "Flat viewing on Saturday" })
        let statuses = Dictionary(uniqueKeysWithValues: flat.recipients.map { ($0.email, $0.status) })
        #expect(statuses[DemoPeople.tomas.address] == .opened)
        #expect(statuses[DemoPeople.sam.address] == .replied)
        let proposal = try #require(tracked.first { $0.subject == "Draft proposal for review" })
        #expect(proposal.summary.status == .sent)
    }

    @Test("a calendar invite, attachments, quoted replies and a long HTML newsletter are in the mailbox")
    func content() async throws {
        let app = try await SeededApp.make()
        defer { Task { await app.tearDown() } }
        let invite = try #require(try await app.thread(subject: "Invitation: Logo review @ Thu 3:00 PM"))
        let inviteDetail = try await app.model.threadDetail(invite.id)
        #expect(inviteDetail.messages.first?.attachments.contains { $0.contentType == "text/calendar" } == true)

        let lake = try #require(try await app.thread(subject: "Photos from the lake"))
        #expect(lake.hasAttachments)
        #expect(try await app.model.threadDetail(lake.id).messages.first?.attachments.count == 2)

        let roadmap = try #require(try await app.thread(subject: "Q4 roadmap notes"))
        let messages = try await app.model.threadDetail(roadmap.id).messages
        #expect(messages.count == 3)
        #expect(messages.last?.text?.contains("wrote:") == true)

        let maker = try #require(try await app.thread(subject: "Quarterly Maker, Autumn issue: workshops, tools and a very long essay"))
        let html = try #require(try await app.model.threadDetail(maker.id).messages.first?.html)
        #expect(html.count > 3000)
    }
}

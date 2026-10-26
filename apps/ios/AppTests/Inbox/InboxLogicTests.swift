@testable import Flint
import FlintModel
import Foundation
import Testing

enum InboxFixtures {
    static func item(
        _ id: Int, subject: String = "Subject", date: EpochMs = 0, unread: Int = 0, pinned: Bool = false, attachments: Bool = false,
        from: [Address] = [Address(name: "Ana Reyes", address: "ana@example.com")], snoozedUntil: EpochMs? = nil,
        code: CodeBadge? = nil, draft: DraftRef? = nil
    ) -> ThreadListItem {
        ThreadListItem(
            id: id, accountId: "a1", subject: subject, snippet: "snippet", participants: from, lastDate: date, messageCount: 1,
            unreadCount: unread, hasAttachments: attachments, pinned: pinned, snoozedUntil: snoozedUntil, verificationCode: code,
            draft: draft)
    }

    static func ephemeralDefaults() -> UserDefaults {
        let name = "flint.tests.inbox.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name) ?? .standard
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    static var utc: FlintTime {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        calendar.firstWeekday = 2
        return FlintTime(calendar: calendar, locale: Locale(identifier: "en_US"))
    }
}

@Suite("Inbox filter")
struct InboxFilterTests {
    @Test("all leaves the query alone")
    func all() {
        let query = ThreadQuery(view: .inbox, focused: true)
        #expect(InboxFilter.all.apply(to: query) == query)
    }

    @Test("unread and attachments unfold bundles and set one flag each")
    func flags() {
        let query = ThreadQuery(view: .inbox, focused: true)
        let unread = InboxFilter.unread.apply(to: query)
        #expect(unread.unreadOnly && !unread.hasAttachments && !unread.focused)
        let files = InboxFilter.attachments.apply(to: query)
        #expect(files.hasAttachments && !files.unreadOnly && !files.focused)
    }

    @Test("available on inbox-like lists only")
    func availability() {
        #expect(InboxFilter.isAvailable(for: .unifiedInbox))
        #expect(InboxFilter.isAvailable(for: .folder("a", 1)))
        #expect(!InboxFilter.isAvailable(for: .trash))
        #expect(!InboxFilter.isAvailable(for: .drafts))
        #expect(!InboxFilter.isAvailable(for: .scheduled))
    }
}

@Suite("Inbox grouping")
struct InboxGroupingTests {
    @Test("consecutive rows with one label share a section")
    func groups() {
        let time = InboxFixtures.utc
        let now = Date(timeIntervalSince1970: 1_790_000_000)  // Thursday 2026-09-21 UTC
        let ms = { (offset: TimeInterval) in EpochMs((now.timeIntervalSince1970 + offset) * 1000) }
        let items = [
            InboxFixtures.item(1, date: ms(-60)), InboxFixtures.item(2, date: ms(-120)),
            InboxFixtures.item(3, date: ms(-86_400)), InboxFixtures.item(4, date: ms(-86_400 * 60)),
        ]
        let sections = InboxGrouping.sections(items, time: time, now: now)
        #expect(sections.map(\.label) == ["TODAY", "YESTERDAY", time.dateGroupLabel(items[3].lastDate, now: now)])
        #expect(sections.map { $0.items.map(\.id) } == [[1, 2], [3], [4]])
    }

    @Test("empty list has no sections")
    func empty() {
        #expect(InboxGrouping.sections([]).isEmpty)
    }
}

@Suite("Swipe actions")
struct SwipeActionTests {
    private let plain = InboxFixtures.item(1, unread: 1)
    private let pinned = InboxFixtures.item(2, pinned: true)

    @Test("the same action means different things per list")
    func resolution() {
        #expect(InboxOp.resolve(.archive, for: plain, in: .unifiedInbox) == .archive)
        #expect(InboxOp.resolve(.archive, for: plain, in: .archive) == .moveToInbox)
        #expect(InboxOp.resolve(.archive, for: plain, in: .trash) == .moveToInbox)
        #expect(InboxOp.resolve(.trash, for: plain, in: .trash) == nil)
        #expect(InboxOp.resolve(.snooze, for: plain, in: .snoozed) == .unsnooze)
        #expect(InboxOp.resolve(.snooze, for: plain, in: .unifiedInbox) == .snooze)
    }

    @Test("pin and read toggle from the row's state")
    func toggles() {
        #expect(InboxOp.resolve(.pin, for: plain, in: .unifiedInbox) == .pin(true))
        #expect(InboxOp.resolve(.pin, for: pinned, in: .unifiedInbox) == .pin(false))
        #expect(InboxOp.resolve(.read, for: plain, in: .unifiedInbox) == .read(true))
        #expect(InboxOp.resolve(.read, for: pinned, in: .unifiedInbox) == .read(false))
    }

    @Test("drafts only delete")
    func drafts() {
        #expect(InboxOp.resolve(.trash, for: plain, in: .drafts) == .deleteDraft)
        #expect(InboxOp.resolve(.archive, for: plain, in: .drafts) == nil)
        #expect(InboxOp.batch([plain], in: .drafts) == [.deleteDraft])
    }

    @Test("batch bar follows the selection")
    func batch() {
        let ops = InboxOp.batch([plain, pinned], in: .unifiedInbox)
        #expect(ops == [.archive, .trash, .pin(true), .read(true), .snooze, .move])
        #expect(InboxOp.batch([pinned], in: .trash) == [.moveToInbox, .pin(false), .read(false), .snooze, .move])
    }

    @Test("configuration keeps three unique actions per side")
    func clean() {
        let config = SwipeConfiguration(leading: [.pin, .pin, .read, .move, .archive], trailing: [])
        #expect(config.leading == [.pin, .read, .move])
        #expect(config.trailing.isEmpty)
    }

    @Test("configuration survives a save and load; bad data falls back")
    func persistence() {
        let defaults = InboxFixtures.ephemeralDefaults()
        #expect(SwipeConfiguration.load(from: defaults) == .standard)
        let custom = SwipeConfiguration(leading: [.archive], trailing: [.trash, .move])
        custom.save(to: defaults)
        #expect(SwipeConfiguration.load(from: defaults) == custom)
        defaults.set(Data("nope".utf8), forKey: SwipeConfiguration.storageKey)
        #expect(SwipeConfiguration.load(from: defaults) == .standard)
    }
}

@Suite("Row text")
struct InboxRowTextTests {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)
    private var nowMs: EpochMs { Int(now.timeIntervalSince1970 * 1000) }

    @Test("draft rows tag the sender and drop me")
    func sender() {
        let draft = InboxFixtures.item(
            1, from: [Address(name: "Ana Reyes", address: "ana@example.com"), Address(name: "me", address: "m@example.com")],
            draft: DraftRef(draftId: 4))
        let text = InboxRowText.sender(draft)
        #expect(text.isDraft && text.text == "Ana Reyes")
        #expect(InboxRowText.lead(draft).address == "ana@example.com")
    }

    @Test("a code shows until it is used or expires")
    func codes() {
        let live = CodeBadge(id: "c", code: "482913", service: "Bank", expiresAt: nowMs + 60_000, used: false)
        #expect(InboxRowText.liveCode(InboxFixtures.item(1, code: live), now: now)?.code == "482913")
        var used = live
        used.used = true
        #expect(InboxRowText.liveCode(InboxFixtures.item(1, code: used), now: now) == nil)
        var old = live
        old.expiresAt = nowMs - 1
        #expect(InboxRowText.liveCode(InboxFixtures.item(1, code: old), now: now) == nil)
    }

    @Test("invites need an attachment and an invitation subject")
    func invites() {
        #expect(InboxRowText.isInvite(InboxFixtures.item(1, subject: "Invitation: Design review @ Tue", attachments: true)))
        #expect(!InboxRowText.isInvite(InboxFixtures.item(1, subject: "Invitation: Design review", attachments: false)))
        #expect(!InboxRowText.isInvite(InboxFixtures.item(1, subject: "Lunch?", attachments: true)))
    }

    @Test("snoozed rows show the wake time, past snoozes show the date")
    func time() {
        let future = InboxFixtures.item(1, date: nowMs - 3_600_000, snoozedUntil: nowMs + 86_400_000)
        #expect(InboxRowText.time(future, now: now).snoozed)
        let past = InboxFixtures.item(1, date: nowMs - 3_600_000, snoozedUntil: nowMs - 1)
        #expect(!InboxRowText.time(past, now: now).snoozed)
    }

    @Test("empty subject reads (no subject)")
    func noSubject() {
        #expect(InboxRowText.subject(InboxFixtures.item(1, subject: "")) == "(no subject)")
    }
}

@Suite("Empty copy")
struct InboxEmptyCopyTests {
    @Test("every list says something and filters win")
    func copy() {
        let lists: [MailboxSelection] = [.unifiedInbox, .pinned, .drafts, .scheduled, .snoozed, .sent, .archive, .trash, .spam, .folder("a", 1)]
        for list in lists { #expect(!InboxEmptyCopy.copy(for: list, category: nil, filter: .all).title.isEmpty) }
        #expect(InboxEmptyCopy.copy(for: .unifiedInbox, category: nil, filter: .unread).title == "No unread mail here.")
        #expect(InboxEmptyCopy.copy(for: .unifiedInbox, category: .newsletters, filter: .all).title == "No newsletters.")
        #expect(InboxEmptyCopy.copy(for: .unifiedInbox, category: nil, filter: .all).title == "Inbox zero.")
    }
}

@Suite("Account color")
struct AccountColorTests {
    @Test("parses hex with or without a hash")
    func hex() {
        #expect(AccountColor.color("#4C8DFF") != nil)
        #expect(AccountColor.color("4C8DFF") != nil)
        #expect(AccountColor.color("blue") == nil)
        #expect(AccountColor.color("#12") == nil)
    }
}

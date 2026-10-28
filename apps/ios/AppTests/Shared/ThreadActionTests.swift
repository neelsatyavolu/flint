@testable import Flint
import FlintModel
import Foundation
import Testing

/// Toast wording follows `state/actions.ts` of the desktop app.
@Suite("Thread action copy")
struct ThreadActionTests {
    private let now = Date(timeIntervalSince1970: 1_792_597_740)

    @Test("single and multiple conversations")
    func counts() {
        #expect(ThreadAction.archive.message(count: 1) == "Archived")
        #expect(ThreadAction.archive.message(count: 3) == "Archived 3 conversations")
        #expect(ThreadAction.trash.message(count: 1) == "Moved to Trash")
        #expect(ThreadAction.trash.message(count: 2) == "Moved 2 conversations to Trash")
        #expect(ThreadAction.spam(true).message(count: 1) == "Marked as spam")
        #expect(ThreadAction.spam(true).message(count: 4) == "Marked 4 conversations as spam")
        #expect(ThreadAction.spam(false).message(count: 4) == "Not spam")
    }

    @Test("other actions")
    func others() {
        #expect(ThreadAction.mute(true).message(count: 1) == "Muted")
        #expect(ThreadAction.mute(false).message(count: 1) == "Unmuted")
        #expect(ThreadAction.unsnooze.message(count: 1) == "Snooze removed")
        #expect(ThreadAction.inbox.message(count: 1) == "Moved to Inbox")
        #expect(ThreadAction.move(folderName: "Receipts").message(count: 1) == "Moved to Receipts")
        #expect(ThreadAction.category(.newsletters, rememberSender: false).message(count: 1) == "Moved to Newsletters")
        #expect(ThreadAction.category(.newsletters, rememberSender: true).message(count: 1) == "Mail from this sender will go to Newsletters")
        #expect(ThreadAction.category(.notifications, rememberSender: true).message(count: 2) == "Mail from these senders will go to Notifications")
    }

    @Test("snooze names the resolved time")
    func snooze() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let presets = SnoozePresets(calendar: calendar, locale: Locale(identifier: "en_US"))
        let until = Int(now.addingTimeInterval(3 * 3600).timeIntervalSince1970 * 1000)
        #expect(ThreadAction.snooze(until: until).message(count: 1, now: now, presets: presets) == "Snoozed until 6:49 PM")
    }

    @Test("pin and read are quiet; every failure ends with Try again")
    func quietAndFailures() {
        #expect(ThreadAction.pin(true).message(count: 1) == nil)
        #expect(ThreadAction.read(true).message(count: 1) == nil)
        let all: [ThreadAction] = [.archive, .trash, .spam(true), .mute(true), .snooze(until: 0), .unsnooze, .move(folderName: "x"), .inbox, .category(.people, rememberSender: false), .pin(true), .read(true)]
        for action in all { #expect(action.failure.hasSuffix("Try again.")) }
    }
}

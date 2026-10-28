import XCTest

/// Snooze, send later and follow-up reminders on the demo mailbox: the one time picker in each place it opens, the iOS limit
/// stated on send later, and a scheduled send changed from the Scheduled list. `testScreens` saves screenshots of each sheet
/// (see `ScreenTourTests` for `FLINT_SHOT_DIR` and `FLINT_SHOT_PREFIX`).
final class SchedulingTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    @MainActor
    private func addRecipient(_ app: XCUIApplication) {
        let to = app.textFields["composer.to.field"]
        XCTAssertTrue(to.waitForExistence(timeout: 15))
        to.tap()
        to.typeText("daniel")
        let suggestion = app.buttons["composer.to.suggestion.daniel.reyes@northwind.example"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 10))
        suggestion.tap()
    }

    @MainActor
    func testSendLaterStatesTheLimitAndSchedules() {
        let app = ComposerTests.openComposer()
        XCTAssertTrue(element(app, "composer.root").waitForExistence(timeout: 30))
        addRecipient(app)
        let subject = app.textFields["composer.subject"]
        subject.tap()
        subject.typeText("Later")
        app.buttons["composer.schedule"].tap()
        let note = element(app, "composer.schedule.note")
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        XCTAssertTrue(note.label.hasPrefix("Sends when Flint can run"), note.label)
        app.buttons["composer.schedule.tomorrow"].tap()
        let toast = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Scheduled for'")).firstMatch
        XCTAssertTrue(toast.waitForExistence(timeout: 15), "the toast says when it goes")
        XCTAssertTrue(app.buttons["toast.undo"].exists)
    }

    @MainActor
    func testFollowUpReminderIsSetAndCleared() {
        let app = ComposerTests.openComposer()
        XCTAssertTrue(app.buttons["composer.reminder"].waitForExistence(timeout: 30))
        XCTAssertEqual(app.buttons["composer.reminder"].label, "Remind me if no reply")
        app.buttons["composer.reminder"].tap()
        for id in ["day", "days3", "week"] { XCTAssertTrue(app.buttons["composer.reminder.\(id)"].waitForExistence(timeout: 5), id) }
        XCTAssertFalse(app.buttons["composer.reminder.clear"].exists, "nothing to remove yet")
        app.buttons["composer.reminder.days3"].tap()
        XCTAssertTrue(app.buttons["composer.reminder"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["composer.reminder"].label, "Reminder set")
        app.buttons["composer.reminder"].tap()
        let clear = app.buttons["composer.reminder.clear"]
        XCTAssertTrue(clear.waitForExistence(timeout: 5))
        clear.tap()
        XCTAssertTrue(app.buttons["composer.reminder"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["composer.reminder"].label, "Remind me if no reply")
    }

    @MainActor
    func testScheduledSendCanChangeTime() {
        let app = ShellTests.launchSeeded(route: "scheduled")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'inbox.scheduled.'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        row.tap()
        XCTAssertTrue(element(app, "scheduled.root").waitForExistence(timeout: 10))
        app.buttons["scheduled.change"].tap()
        XCTAssertTrue(element(app, "scheduled.time.note").waitForExistence(timeout: 5))
        app.buttons["scheduled.time.tomorrow"].tap()
        let toast = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Scheduled for'")).firstMatch
        XCTAssertTrue(toast.waitForExistence(timeout: 15))
    }

    @MainActor
    func testInboxSnoozeUsesTheSamePicker() {
        let app = ShellTests.launchSeeded()
        let first = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'inbox.row.'")).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 30))
        first.swipeLeft()
        app.buttons["inbox.swipe.snooze"].tap()
        XCTAssertTrue(element(app, "inbox.snooze.root").waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.buttons["inbox.snooze.tomorrow"].exists)
        XCTAssertFalse(element(app, "inbox.snooze.note").exists, "snooze has no send-later note")
    }

    // MARK: Screenshots

    @MainActor
    private func shot(_ name: String) {
        sleep(1)
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let env = ProcessInfo.processInfo.environment
        guard let dir = env["FLINT_SHOT_DIR"] else { return }
        let prefix = env["FLINT_SHOT_PREFIX"] ?? (UIDevice.current.userInterfaceIdiom == .pad ? "pad" : "phone")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)-\(name).png"))
    }

    @MainActor
    private func screens(_ theme: String) {
        var app = ShellTests.launchSeeded(appearance: theme, route: "thread:Q4 roadmap")
        XCTAssertTrue(app.buttons["thread.snooze"].waitForExistence(timeout: 30))
        app.buttons["thread.snooze"].tap()
        XCTAssertTrue(element(app, "thread.snooze.root").waitForExistence(timeout: 10))
        shot("snooze-\(theme)")
        app.terminate()

        app = ShellTests.launchSeeded(appearance: theme, route: "scheduled")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'inbox.scheduled.'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        row.tap()
        XCTAssertTrue(element(app, "scheduled.root").waitForExistence(timeout: 10))
        shot("scheduled-\(theme)")
        app.buttons["scheduled.change"].tap()
        XCTAssertTrue(element(app, "scheduled.time.note").waitForExistence(timeout: 5))
        shot("scheduled-time-\(theme)")
        app.terminate()

        app = ComposerTests.openComposerThemed(theme)
        XCTAssertTrue(app.buttons["composer.schedule"].waitForExistence(timeout: 30))
        shot("composer-\(theme)")
        app.buttons["composer.schedule"].tap()
        XCTAssertTrue(element(app, "composer.schedule.note").waitForExistence(timeout: 5))
        shot("send-later-\(theme)")
        app.buttons["composer.schedule.custom"].tap()
        XCTAssertTrue(app.buttons["composer.schedule.confirm"].waitForExistence(timeout: 5))
        shot("send-later-custom-\(theme)")
        app.buttons["Close"].firstMatch.tap()
        app.buttons["composer.reminder"].tap()
        XCTAssertTrue(app.buttons["composer.reminder.days3"].waitForExistence(timeout: 5))
        shot("reminder-\(theme)")
        app.buttons["composer.reminder.days3"].tap()
        XCTAssertEqual(app.buttons["composer.reminder"].label, "Reminder set")
        shot("composer-reminder-set-\(theme)")
        app.terminate()
    }

    @MainActor func testGraphiteScreens() { screens("dark") }
    @MainActor func testPaperScreens() { screens("light") }
}

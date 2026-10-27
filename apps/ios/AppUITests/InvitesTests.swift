import XCTest

/// Opens the seeded calendar invitation, answers Maybe and adds it to the calendar. The demo mailbox swaps in a calendar that does
/// not touch the simulator's own, and the answer goes through the fake mail transport. Screenshots are written like the screen
/// tour's: `TEST_RUNNER_FLINT_SHOT_DIR` and `TEST_RUNNER_FLINT_SHOT_PREFIX`.
final class InvitesTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    private func element(_ app: XCUIApplication, prefix: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).firstMatch
    }

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
    private func run(theme: String) {
        let app = ShellTests.launchSeeded(appearance: theme, route: "thread:Invitation: Logo review")
        let add = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'invite.addToCalendar.'")).firstMatch
        let found = add.waitForExistence(timeout: 30)
        if !found { shot("invite-missing-\(theme)"); print("DEBUGTREE", app.debugDescription) }
        XCTAssertTrue(found, "the invite card should show for the seeded invitation")
        XCTAssertTrue(app.staticTexts["Invitation"].exists)
        XCTAssertTrue(app.staticTexts["Logo review"].exists)
        XCTAssertTrue(app.staticTexts["Studio B"].exists)
        shot("invite-new-\(theme)")

        let maybe = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'invite.answer.tentative.'")).firstMatch
        XCTAssertTrue(maybe.waitForExistence(timeout: 5))
        maybe.tap()
        XCTAssertTrue(app.staticTexts["You: Maybe"].waitForExistence(timeout: 20), "the card should show the new answer")
        XCTAssertTrue(app.buttons["toast.undo"].waitForExistence(timeout: 10), "the reply is queued with the usual undo window")

        add.tap()
        XCTAssertTrue(app.buttons["Added to Calendar"].waitForExistence(timeout: 10))
        shot("invite-answered-\(theme)")
    }

    @MainActor func testAnswerAndAddToCalendarInGraphite() { run(theme: "dark") }
    @MainActor func testAnswerAndAddToCalendarInPaper() { run(theme: "light") }
}

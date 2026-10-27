import XCTest

/// Read receipts on the demo mailbox: the read status under a tracked send, then the Read statuses list. Screenshots are
/// attached to the result and, when `FLINT_SHOT_DIR` is set (`TEST_RUNNER_FLINT_SHOT_DIR` for xcodebuild), written there as PNGs.
final class ReceiptsTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    @MainActor
    private func prefixed(_ app: XCUIApplication, _ prefix: String) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix))
    }

    @MainActor
    private func shot(_ app: XCUIApplication, _ name: String) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let dir = ProcessInfo.processInfo.environment["FLINT_SHOT_DIR"] ?? ProcessInfo.processInfo.environment["TEST_RUNNER_FLINT_SHOT_DIR"]
        if let dir {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    /// Opens the tracked send and expands its (older, folded) card.
    @MainActor
    private func openTrackedSend(appearance: String) -> XCUIApplication {
        let app = ShellTests.launchSeeded(appearance: appearance, route: "thread:Flat viewing")
        XCTAssertTrue(element(app, "thread.root").waitForExistence(timeout: 25))
        let folded = prefixed(app, "thread.collapsed.").firstMatch
        if folded.waitForExistence(timeout: 10) { folded.tap() }
        XCTAssertTrue(prefixed(app, "thread.receipt.").firstMatch.waitForExistence(timeout: 10), "the sent message should show its read status")
        return app
    }

    @MainActor
    func testReadStatusUnderATrackedSend() {
        let app = openTrackedSend(appearance: "dark")
        let opened = prefixed(app, "thread.receipt.recipient.").matching(NSPredicate(format: "label CONTAINS 'Opened'")).firstMatch
        let replied = prefixed(app, "thread.receipt.recipient.").matching(NSPredicate(format: "label CONTAINS 'Replied'")).firstMatch
        XCTAssertTrue(opened.waitForExistence(timeout: 5), "Tomas opened it")
        XCTAssertTrue(replied.exists, "Sam replied")
        XCTAssertTrue(opened.label.contains("Apple Mail"), opened.label)
        shot(app, "thread-dark")
    }

    @MainActor
    func testReadStatusesListMainPath() {
        let app = openTrackedSend(appearance: "dark")
        let all = prefixed(app, "thread.receipt.all.").firstMatch
        XCTAssertTrue(all.waitForExistence(timeout: 5))
        if !all.isHittable { app.swipeUp() }
        all.tap()
        XCTAssertTrue(element(app, "receipts.root").waitForExistence(timeout: 10))
        XCTAssertTrue(prefixed(app, "receipts.row.").firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(prefixed(app, "receipts.open.").count, 2, "the two tracked sends of the demo mailbox")
        shot(app, "list-dark")

        // Not opened: only the proposal to Priya.
        element(app, "receipts.filter.unopened").tap()
        XCTAssertTrue(prefixed(app, "receipts.row.").firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(prefixed(app, "receipts.open.").count, 1)
        XCTAssertTrue(prefixed(app, "receipts.recipient.").firstMatch.label.contains("No open detected"))

        // Opened: the flat viewing, with its timeline behind the disclosure.
        element(app, "receipts.filter.opened").tap()
        let toggle = prefixed(app, "receipts.timelineToggle.").firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        toggle.tap()
        XCTAssertTrue(prefixed(app, "receipts.timeline.").firstMatch.waitForExistence(timeout: 5))
        shot(app, "list-timeline-dark")

        // Refresh: the demo has no receipts service address, so the list says so and keeps its rows.
        app.buttons["Refresh"].firstMatch.tap()
        XCTAssertTrue(element(app, "receipts.notice").waitForExistence(timeout: 10))
        XCTAssertTrue(prefixed(app, "receipts.row.").firstMatch.exists)
        element(app, "receipts.howItWorks").tap()
        XCTAssertTrue(element(app, "receipts.howItWorks.text").waitForExistence(timeout: 5))
        shot(app, "list-notice-dark")
    }

    @MainActor
    func testPaperScreens() {
        let app = openTrackedSend(appearance: "light")
        shot(app, "thread-light")
        let all = prefixed(app, "thread.receipt.all.").firstMatch
        if !all.isHittable { app.swipeUp() }
        all.tap()
        XCTAssertTrue(element(app, "receipts.root").waitForExistence(timeout: 10))
        XCTAssertTrue(prefixed(app, "receipts.row.").firstMatch.waitForExistence(timeout: 10))
        shot(app, "list-light")
        element(app, "receipts.filter.unopened").tap()
        shot(app, "list-unopened-light")
    }
}

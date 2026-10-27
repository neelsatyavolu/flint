import XCTest

/// The composer on the demo mailbox: write a message, add a recipient from the suggestions, send it, see the undo toast.
final class ComposerTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// Opens the demo inbox and taps New message (the inbox's compose button is found by its label).
    @MainActor
    static func openComposer() -> XCUIApplication {
        let app = ShellTests.launchSeeded()
        let compose = app.buttons["New message"]
        if compose.waitForExistence(timeout: 30) { compose.tap() }
        return app
    }

    @MainActor
    static func openComposerThemed(_ appearance: String) -> XCUIApplication {
        let app = ShellTests.launchSeeded(appearance: appearance)
        let compose = app.buttons["New message"]
        if compose.waitForExistence(timeout: 30) { compose.tap() }
        return app
    }

    @MainActor
    func testWriteAndSend() {
        let app = Self.openComposer()
        XCTAssertTrue(app.descendants(matching: .any)["composer.root"].waitForExistence(timeout: 30))
        let to = app.textFields["composer.to.field"]
        XCTAssertTrue(to.waitForExistence(timeout: 15))
        to.tap()
        to.typeText("daniel")
        let suggestion = app.buttons["composer.to.suggestion.daniel.reyes@northwind.example"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 10), "a contact suggestion should appear")
        suggestion.tap()
        XCTAssertTrue(app.buttons["composer.to.chip.daniel.reyes@northwind.example"].waitForExistence(timeout: 5))

        let subject = app.textFields["composer.subject"]
        subject.tap()
        subject.typeText("Roadmap follow up")

        let body = app.textViews["composer.body"]
        body.tap()
        body.typeText("Thanks for the notes.")
        app.buttons["composer.format.bold"].tap()
        body.typeText(" Bold part")

        app.buttons["composer.send"].tap()
        XCTAssertTrue(app.buttons["Undo"].waitForExistence(timeout: 15), "the send toast should show")
        XCTAssertFalse(app.descendants(matching: .any)["composer.root"].exists)
    }

    @MainActor
    func testSendWithoutRecipientShowsProblem() {
        let app = Self.openComposer()
        XCTAssertTrue(app.buttons["composer.send"].waitForExistence(timeout: 30))
        app.buttons["composer.send"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["composer.problem"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["composer.root"].exists)
    }

    @MainActor
    func testScheduleSheetOpensWithPresets() {
        let app = Self.openComposer()
        XCTAssertTrue(app.buttons["composer.schedule"].waitForExistence(timeout: 30))
        app.buttons["composer.schedule"].tap()
        XCTAssertTrue(app.buttons["composer.schedule.tomorrow"].waitForExistence(timeout: 5))
        app.buttons["composer.schedule.custom"].tap()
        XCTAssertTrue(app.buttons["composer.schedule.confirm"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testDiscardAsksFirst() {
        let app = Self.openComposer()
        XCTAssertTrue(app.buttons["composer.discard"].waitForExistence(timeout: 30))
        app.buttons["composer.discard"].tap()
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 5))
        app.alerts.buttons["Discard"].tap()
        XCTAssertFalse(app.descendants(matching: .any)["composer.root"].waitForExistence(timeout: 3))
    }
}

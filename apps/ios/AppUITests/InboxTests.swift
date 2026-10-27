import XCTest

/// Main path of the inbox over the demo mailbox: rows and bundles, the filter, selecting with the batch bar, a swipe with undo,
/// and opening a conversation.
final class InboxTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func rows(_ app: XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'inbox.row.'"))
    }

    @MainActor
    func testInboxShowsBundlesAndRows() {
        let app = ShellTests.launchSeeded()
        XCTAssertTrue(app.otherElements["inbox.root"].waitForExistence(timeout: 20))
        XCTAssertTrue(rows(app).firstMatch.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.descendants(matching: .any)["inbox.bundle.notifications"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["inbox.bundle.newsletters"].exists)
    }

    @MainActor
    func testVerificationCodeChipCopiesTheCode() {
        let app = ShellTests.launchSeeded()
        // The demo's code mail sits in the Notifications bundle.
        let bundle = app.descendants(matching: .any)["inbox.bundle.notifications"]
        XCTAssertTrue(bundle.waitForExistence(timeout: 30))
        bundle.tap()
        let chip = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'inbox.code.'")).firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertTrue(chip.label.contains("482913"))
        chip.tap()
        XCTAssertTrue(app.staticTexts["Code copied"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testFilterSelectBatchAndUndo() {
        let app = ShellTests.launchSeeded()
        XCTAssertTrue(rows(app).firstMatch.waitForExistence(timeout: 25))

        app.buttons["inbox.filter.unread"].tap()
        XCTAssertTrue(rows(app).firstMatch.waitForExistence(timeout: 10))
        // The list re-renders a moment after the tap, so wait for the bundle row to go instead of reading it at once.
        XCTAssertTrue(app.descendants(matching: .any)["inbox.bundle.notifications"].waitForNonExistence(timeout: 10))
        app.buttons["inbox.filter.all"].tap()

        app.buttons["inbox.more"].tap()
        app.buttons["inbox.select"].tap()
        XCTAssertTrue(app.buttons["inbox.selectAll"].waitForExistence(timeout: 5))
        rows(app).element(boundBy: 0).tap()
        XCTAssertTrue(app.descendants(matching: .any)["inbox.batch"].waitForExistence(timeout: 5))
        app.buttons["inbox.batch.archive"].tap()

        XCTAssertTrue(app.buttons["toast.undo"].waitForExistence(timeout: 5))
        app.buttons["toast.undo"].tap()
        XCTAssertFalse(app.buttons["inbox.selectCancel"].exists)
    }

    @MainActor
    func testOpenBundleAndBack() {
        let app = ShellTests.launchSeeded()
        let bundle = app.descendants(matching: .any)["inbox.bundle.newsletters"]
        XCTAssertTrue(bundle.waitForExistence(timeout: 25))
        bundle.tap()
        XCTAssertTrue(app.buttons["inbox.back"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["inbox.bundle.newsletters"].exists)
        app.buttons["inbox.back"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["inbox.bundle.newsletters"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testSwipeArchiveShowsUndoThenOpensThread() {
        let app = ShellTests.launchSeeded()
        let first = rows(app).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 25))
        first.swipeLeft()
        let archive = app.buttons["inbox.swipe.archive"]
        XCTAssertTrue(archive.waitForExistence(timeout: 5))
        archive.tap()
        XCTAssertTrue(app.buttons["toast.undo"].waitForExistence(timeout: 5))

        rows(app).firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["thread.root"].waitForExistence(timeout: 10), app.debugDescription)
    }
}

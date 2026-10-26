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
    func testFilterSelectBatchAndUndo() {
        let app = ShellTests.launchSeeded()
        XCTAssertTrue(rows(app).firstMatch.waitForExistence(timeout: 25))

        app.buttons["inbox.filter.unread"].tap()
        XCTAssertTrue(rows(app).firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any)["inbox.bundle.notifications"].exists)
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

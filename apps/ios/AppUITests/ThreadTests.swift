import XCTest

/// Opens a seeded conversation and exercises the reader: header, cards, quoted text, reply dock, and the composer it opens.
final class ThreadTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    func testReaderMainPath() {
        let app = ShellTests.launchSeeded(route: "thread:Q4 roadmap")
        XCTAssertTrue(app.descendants(matching: .any)["thread.root"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.descendants(matching: .any)["thread.subject"].waitForExistence(timeout: 10))
        let card = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'thread.message.'")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["thread.archive"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["thread.reply"].waitForExistence(timeout: 10))

        let collapsed = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'thread.collapsed.'")).firstMatch
        if collapsed.exists {
            collapsed.tap()
            XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'thread.messageHeader.'")).element(boundBy: 1).waitForExistence(timeout: 5))
        }

        let forward = app.buttons["thread.forward"]
        XCTAssertTrue(forward.waitForExistence(timeout: 10))
        forward.tap()
        XCTAssertTrue(app.descendants(matching: .any)["composer.root"].waitForExistence(timeout: 10) || app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH 'composer'")).firstMatch.waitForExistence(timeout: 10))
    }

    @MainActor
    func testSnoozeFromTheThreadBar() {
        let app = ShellTests.launchSeeded(route: "thread:Q4 roadmap")
        let snooze = app.buttons["thread.snooze"]
        XCTAssertTrue(snooze.waitForExistence(timeout: 20))
        snooze.tap()
        XCTAssertTrue(app.descendants(matching: .any)["thread.snooze.root"].waitForExistence(timeout: 10))
        let tomorrow = app.buttons["thread.snooze.tomorrow"]
        XCTAssertTrue(tomorrow.waitForExistence(timeout: 5))
        tomorrow.tap()
        XCTAssertTrue(app.buttons["toast.undo"].waitForExistence(timeout: 10), "snoozing should show the undo toast")
    }

    @MainActor
    func testMoveToFolderFromTheThreadMenu() {
        let app = ShellTests.launchSeeded(route: "thread:Q4 roadmap")
        let more = app.buttons["thread.more"]
        XCTAssertTrue(more.waitForExistence(timeout: 20))
        more.tap()
        let move = app.buttons["Move to folder"]
        XCTAssertTrue(move.waitForExistence(timeout: 5))
        move.tap()
        XCTAssertTrue(app.descendants(matching: .any)["thread.move.root"].waitForExistence(timeout: 10))
        let folder = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'thread.move.folder.'")).firstMatch
        XCTAssertTrue(folder.waitForExistence(timeout: 10))
        folder.tap()
        XCTAssertTrue(app.buttons["toast.undo"].waitForExistence(timeout: 10), "moving should show the undo toast")
    }
}

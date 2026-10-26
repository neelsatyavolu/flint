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
        XCTAssertTrue(app.descendants(matching: .any)["thread.archive"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["thread.reply"].exists || app.descendants(matching: .any)["thread.replyAll"].exists)

        let collapsed = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'thread.collapsed.'")).firstMatch
        if collapsed.exists {
            collapsed.tap()
            XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'thread.messageHeader.'")).element(boundBy: 1).waitForExistence(timeout: 5))
        }

        let forward = app.descendants(matching: .any)["thread.forward"]
        XCTAssertTrue(forward.exists)
        forward.tap()
        XCTAssertTrue(app.descendants(matching: .any)["composer.root"].waitForExistence(timeout: 10) || app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH 'composer'")).firstMatch.waitForExistence(timeout: 10))
    }
}

import XCTest

/// Opens search from the inbox on the demo mailbox, types a query, filters with a chip and opens a result.
final class SearchTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    private func openSearch() -> XCUIApplication {
        let app = ShellTests.launchSeeded()
        let open = app.buttons["Search"].firstMatch
        XCTAssertTrue(open.waitForExistence(timeout: 60))
        open.tap()
        let ok = app.descendants(matching: .any)["search.field"].waitForExistence(timeout: 20)
        if !ok { print("DBG", app.debugDescription) }
        XCTAssertTrue(ok)
        return app
    }

    @MainActor
    func testTypeFilterAndOpenResult() {
        let app = openSearch()
        let field = app.descendants(matching: .any)["search.field"]
        field.tap()
        field.typeText("roadmap")
        let results = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'search.result.'"))
        XCTAssertTrue(results.firstMatch.waitForExistence(timeout: 10))

        app.buttons["search.chip.is:unread"].tap()
        XCTAssertTrue((field.value as? String ?? "").contains("is:unread"))

        field.tap()
        app.buttons["search.clear"].tap()
        field.typeText("roadmap")
        XCTAssertTrue(results.firstMatch.waitForExistence(timeout: 10))
        results.firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["thread.root"].waitForExistence(timeout: 15))
    }

    @MainActor
    func testNoMatchesOffersServerSearch() {
        let app = openSearch()
        let field = app.descendants(matching: .any)["search.field"]
        field.tap()
        field.typeText("zzqxnomatch")
        XCTAssertTrue(app.buttons["search.server"].waitForExistence(timeout: 15))
    }
}

import XCTest

/// Opens search on the demo mailbox, types a query, filters with a chip and opens a result.
final class SearchTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    func testTypeFilterAndOpenResult() {
        let app = ShellTests.launchSeeded(route: "search")
        XCTAssertTrue(app.descendants(matching: .any)["search.field"].waitForExistence(timeout: 40))
        
        let field = app.descendants(matching: .any)["search.field"]
        field.tap()
        field.typeText("roadmap")
        let results = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'search.result.'"))
        XCTAssertTrue(results.firstMatch.waitForExistence(timeout: 10))

        app.buttons["search.chip.is:unread"].tap()
        XCTAssertTrue(results.firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue((field.value as? String ?? "").contains("is:unread"))

        results.firstMatch.tap()
        XCTAssertTrue(app.otherElements["thread.root"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testRouteWithQueryShowsResultsAndServerSearch() {
        let app = ShellTests.launchSeeded(route: "search:invoice")
        XCTAssertTrue(app.descendants(matching: .any)["search.field"].waitForExistence(timeout: 40))
        XCTAssertTrue(app.buttons["search.server"].waitForExistence(timeout: 15))
    }
}

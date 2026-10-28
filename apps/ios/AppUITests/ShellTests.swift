import XCTest

/// Launches the demo mailbox (`-FlintSeed demo`) and checks the shell shows seeded data. Feature tracks add their own
/// `AppUITests/<Name>Tests.swift` and reuse `launchSeeded`.
final class ShellTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    static func launchSeeded(appearance: String = "dark", route: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-FlintSeed", "demo", "-FlintAppearance", appearance]
        if let route { app.launchArguments += ["-FlintRoute", route] }
        app.launch()
        return app
    }

    @MainActor
    func testSeededInboxShowsRows() {
        let app = Self.launchSeeded()
        XCTAssertTrue(app.otherElements["inbox.root"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["inbox.search"].exists)
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'inbox.row.'")).firstMatch.waitForExistence(timeout: 10))
    }

    @MainActor
    func testRouteOpensThread() {
        let app = Self.launchSeeded(route: "thread:Q4 roadmap")
        XCTAssertTrue(app.otherElements["thread.root"].waitForExistence(timeout: 20))
    }
}

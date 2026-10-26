import XCTest

/// Opens the sidebar over the demo mailbox, checks the rows, switches to one account and lands on its list.
final class SidebarTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    func testSidebarListsMailboxesAndSwitchesAccount() {
        let app = ShellTests.launchSeeded(route: "sidebar")
        XCTAssertTrue(app.otherElements["sidebar.root"].waitForExistence(timeout: 20))
        for id in ["inbox", "pinned", "drafts", "sent", "scheduled", "snoozed", "trash", "spam", "archive"] {
            XCTAssertTrue(app.buttons["sidebar.row.\(id)"].exists, "missing row \(id)")
        }
        XCTAssertTrue(app.buttons["sidebar.settings"].exists)
        let account = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'sidebar.row.inbox.'")).firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        account.tap()
        XCTAssertTrue(app.descendants(matching: .any)["inbox.root"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testInboxAccountsCollapse() {
        let app = ShellTests.launchSeeded(route: "sidebar")
        let child = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'sidebar.row.inbox.'")).firstMatch
        XCTAssertTrue(child.waitForExistence(timeout: 20))
        app.buttons["sidebar.toggleAccounts"].tap()
        XCTAssertFalse(child.waitForExistence(timeout: 1))
    }

    @MainActor
    func testSettingsEntryOpensSettings() {
        let app = ShellTests.launchSeeded(route: "sidebar")
        XCTAssertTrue(app.buttons["sidebar.settings"].waitForExistence(timeout: 20))
        app.buttons["sidebar.settings"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["settings.root"].waitForExistence(timeout: 10))
    }
}

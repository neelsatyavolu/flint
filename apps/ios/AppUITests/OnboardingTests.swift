import XCTest

/// Onboarding on the demo mailbox. Nothing here signs in: Google would open a real web sheet, and the demo has no mail server
/// to add an account to, so the tests walk the screens and check what is offered.
final class OnboardingTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    func testWelcomeOffersThreeWaysAndMacIsDisabled() {
        let app = ShellTests.launchSeeded(route: "onboarding")
        XCTAssertTrue(app.otherElements["onboarding.root"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["onboarding.google"].exists)
        XCTAssertTrue(app.buttons["onboarding.other"].exists)
        let mac = app.buttons["onboarding.mac"]
        XCTAssertTrue(mac.exists)
        XCTAssertFalse(mac.isEnabled)
    }

    @MainActor
    func testOtherEmailMainPath() {
        let app = ShellTests.launchSeeded(route: "onboarding")
        XCTAssertTrue(app.buttons["onboarding.other"].waitForExistence(timeout: 20))
        app.buttons["onboarding.other"].tap()

        let email = app.textFields["onboarding.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        email.tap()
        email.typeText("maya@gmail.com")

        // A Gmail address offers Google sign-in and explains app passwords. Add stays off until there is a password.
        XCTAssertTrue(app.buttons["onboarding.googleInstead"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["onboarding.passwordHint"].exists)
        XCTAssertFalse(app.buttons["onboarding.add"].isEnabled)
        XCTAssertFalse(app.buttons["onboarding.test"].isEnabled)

        // Servers appear as a summary (detected, or "not found" with the fields open).
        XCTAssertTrue(app.otherElements["onboarding.summary"].waitForExistence(timeout: 30))

        try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/private/tmp/claude-503/3a/ui-other-\(UIDevice.current.userInterfaceIdiom.rawValue).png")) // TMPSHOT
        app.buttons["onboarding.back"].tap()
        XCTAssertTrue(app.buttons["onboarding.google"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testCloseDismissesInDemo() {
        let app = ShellTests.launchSeeded(route: "onboarding")
        XCTAssertTrue(app.buttons["onboarding.close"].waitForExistence(timeout: 20))
        app.buttons["onboarding.close"].tap()
        XCTAssertTrue(app.otherElements["inbox.root"].waitForExistence(timeout: 10))
    }
}

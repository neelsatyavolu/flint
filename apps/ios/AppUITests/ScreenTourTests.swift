import XCTest

/// Walks every main screen on the demo mailbox and saves a screenshot of each, for the integration review in both themes and
/// at a large accessibility text size. Screenshots are attached to the result and, when `TEST_RUNNER_FLINT_SHOT_DIR` is set,
/// written there as `<prefix>-<screen>-<theme>.png`. `TEST_RUNNER_FLINT_SHOT_PREFIX` names the device (default `phone`).
final class ScreenTourTests: XCTestCase {
    override func setUp() { continueAfterFailure = true }

    /// AX3 in the Settings app's Larger Text slider.
    static let ax3 = "UICTContentSizeCategoryAccessibilityXL"

    @MainActor
    static func launch(appearance: String, route: String? = nil, textSize: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-FlintSeed", "demo", "-FlintAppearance", appearance]
        if let route { app.launchArguments += ["-FlintRoute", route] }
        if let textSize { app.launchArguments += ["-UIPreferredContentSizeCategoryName", textSize] }
        app.launch()
        return app
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    @MainActor
    private func shot(_ app: XCUIApplication, _ name: String) {
        sleep(1)
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let env = ProcessInfo.processInfo.environment
        guard let dir = env["FLINT_SHOT_DIR"] else { return }
        let prefix = env["FLINT_SHOT_PREFIX"] ?? "phone"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)-\(name).png"))
    }

    @MainActor
    private func rows(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'inbox.row.'")).firstMatch
    }

    @MainActor
    private func mailScreens(_ theme: String) {
        let app = Self.launch(appearance: theme)
        XCTAssertTrue(rows(app).waitForExistence(timeout: 30))
        shot(app, "inbox-\(theme)")

        let bundle = element(app, "inbox.bundle.newsletters")
        if bundle.waitForExistence(timeout: 5) {
            bundle.tap()
            XCTAssertTrue(element(app, "inbox.back").waitForExistence(timeout: 5))
            shot(app, "bundle-\(theme)")
            element(app, "inbox.back").tap()
        }

        let compose = element(app, "inbox.compose")
        XCTAssertTrue(compose.waitForExistence(timeout: 5))
        compose.tap()
        XCTAssertTrue(element(app, "composer.to.field").waitForExistence(timeout: 15))
        shot(app, "composer-\(theme)")
    }

    @MainActor
    private func routeScreens(_ theme: String) {
        let routes: [(route: String, id: String, name: String)] = [
            ("thread:Q4 roadmap", "thread.root", "thread-plain"),
            ("thread:Engineering Digest", "thread.root", "thread-html"),
            ("thread:Quarterly Maker", "thread.root", "thread-images"),
            ("sidebar", "sidebar.root", "sidebar"),
            ("search", "search.field", "search-empty"),
            ("search:roadmap", "search.field", "search-results"),
            ("onboarding", "onboarding.root", "onboarding"),
            ("snoozed", "inbox.root", "snoozed"),
            ("scheduled", "inbox.root", "scheduled"),
            ("spam", "inbox.root", "empty-spam"),
        ]
        for item in routes {
            let app = Self.launch(appearance: theme, route: item.route)
            XCTAssertTrue(element(app, item.id).waitForExistence(timeout: 30), item.name)
            sleep(2)
            shot(app, "\(item.name)-\(theme)")
            if item.name == "onboarding", element(app, "onboarding.other").exists {
                element(app, "onboarding.other").tap()
                let email = element(app, "onboarding.email")
                if email.waitForExistence(timeout: 5) {
                    email.tap()
                    email.typeText("sam@example.org")
                    _ = element(app, "onboarding.summary").waitForExistence(timeout: 30)
                    shot(app, "onboarding-other-\(theme)")
                }
            }
        }
    }

    @MainActor func testGraphiteMail() { mailScreens("dark") }
    @MainActor func testPaperMail() { mailScreens("light") }
    @MainActor func testGraphiteRoutes() { routeScreens("dark") }
    @MainActor func testPaperRoutes() { routeScreens("light") }

    /// iPad only: the sidebar column from the menu button, then all three columns in landscape with a thread open.
    @MainActor
    func testPadColumns() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad layout") }
        for theme in ["dark", "light"] {
            XCUIDevice.shared.orientation = .portrait
            let app = Self.launch(appearance: theme, route: "thread:Q4 roadmap")
            XCTAssertTrue(element(app, "thread.root").waitForExistence(timeout: 30))
            let menu = element(app, "inbox.menu")
            if !element(app, "sidebar.root").exists, menu.waitForExistence(timeout: 5) { menu.tap() }
            XCTAssertTrue(element(app, "sidebar.root").waitForExistence(timeout: 10), "sidebar column")
            shot(app, "columns-portrait-\(theme)")
            XCUIDevice.shared.orientation = .landscapeLeft
            sleep(2)
            shot(app, "columns-landscape-\(theme)")
            element(app, "inbox.compose").tap()
            XCTAssertTrue(element(app, "composer.to.field").waitForExistence(timeout: 15), "composer panel")
            shot(app, "composer-panel-\(theme)")
        }
        XCUIDevice.shared.orientation = .portrait
    }

    /// Dynamic Type at AX3 on the inbox, a thread and the composer.
    @MainActor
    func testLargeText() {
        let inbox = Self.launch(appearance: "dark", textSize: Self.ax3)
        XCTAssertTrue(rows(inbox).waitForExistence(timeout: 30))
        shot(inbox, "ax3-inbox-dark")
        element(inbox, "inbox.compose").tap()
        XCTAssertTrue(element(inbox, "composer.to.field").waitForExistence(timeout: 15))
        shot(inbox, "ax3-composer-dark")

        let thread = Self.launch(appearance: "light", route: "thread:Q4 roadmap", textSize: Self.ax3)
        XCTAssertTrue(element(thread, "thread.root").waitForExistence(timeout: 30))
        sleep(2)
        shot(thread, "ax3-thread-light")
    }
}

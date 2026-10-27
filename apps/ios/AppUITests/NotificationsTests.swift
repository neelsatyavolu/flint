import XCTest

/// Notifications and Codes on the demo mailbox with the in-memory notification centre (`-FlintFakeNotifications`), so no
/// system prompt appears. Screenshots go to `FLINT_SHOT_DIR` when set.
final class NotificationsTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    private func launch(route: String, appearance: String = "dark", notifications: String = "undetermined") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-FlintSeed", "demo", "-FlintAppearance", appearance, "-FlintRoute", route, "-FlintFakeNotifications", notifications]
        app.launch()
        return app
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    @MainActor
    private func shot(_ app: XCUIApplication, _ name: String) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["FLINT_SHOT_DIR"] {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    @MainActor
    private func scrollTo(_ app: XCUIApplication, _ id: String) {
        var tries = 0
        while !element(app, id).isHittable, tries < 6 {
            app.swipeUp()
            tries += 1
        }
    }

    /// Permission, a check, the diagnostics row, and the Codes strip: the main path.
    @MainActor
    func testPermissionCheckNowAndCodes() {
        let app = launch(route: "settings:notifications")
        XCTAssertTrue(element(app, "settings.notifications.root").waitForExistence(timeout: 25))
        let allow = element(app, "settings.notifications.allow")
        XCTAssertTrue(allow.waitForExistence(timeout: 10))
        shot(app, "notifications-undetermined")
        allow.tap()
        XCTAssertTrue(element(app, "settings.notifications.status.allowed").waitForExistence(timeout: 10))
        XCTAssertFalse(allow.exists)

        scrollTo(app, "settings.notifications.checkNow")
        element(app, "settings.notifications.checkNow").tap()
        let run = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'settings.notifications.run.'")).firstMatch
        XCTAssertTrue(run.waitForExistence(timeout: 20), "Check now leaves a diagnostics row")
        XCTAssertTrue(run.label.contains("Completed"), run.label)
        shot(app, "notifications-diagnostics")
    }

    @MainActor
    func testScopeChoiceAndCodesSwitchesStick() {
        let app = launch(route: "settings:notifications", notifications: "granted")
        XCTAssertTrue(element(app, "settings.notifications.status.allowed").waitForExistence(timeout: 25))
        let scope = element(app, "settings.notifications.scope")
        XCTAssertTrue(scope.waitForExistence(timeout: 10))
        XCTAssertEqual(scope.value as? String, "People only")
        scope.tap()
        app.buttons["All mail"].tap()
        XCTAssertEqual(element(app, "settings.notifications.scope").value as? String, "All mail")
        scrollTo(app, "settings.codes.autoCopy")
        XCTAssertTrue(element(app, "settings.codes.autoCopy").exists)
    }

    @MainActor
    func testDeniedShowsOpenSettings() {
        let app = launch(route: "settings:notifications", notifications: "denied")
        XCTAssertTrue(element(app, "settings.notifications.openSystem").waitForExistence(timeout: 25))
        shot(app, "notifications-denied")
    }

    @MainActor
    func testCodesStripCopiesAndMarksUsed() {
        let app = launch(route: "inbox", notifications: "granted")
        XCTAssertTrue(element(app, "codes.strip").waitForExistence(timeout: 25))
        let copy = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'codes.copy.'")).firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 10))
        XCTAssertEqual(copy.value as? String, "4 8 2 9 1 3")
        shot(app, "codes-strip")
        copy.tap()
        XCTAssertTrue(app.staticTexts["Code copied"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testPaperScreens() {
        let app = launch(route: "settings:notifications", appearance: "light", notifications: "granted")
        XCTAssertTrue(element(app, "settings.notifications.status.allowed").waitForExistence(timeout: 25))
        shot(app, "notifications-paper")
        scrollTo(app, "settings.notifications.checkNow")
        shot(app, "notifications-paper-background")
    }
}

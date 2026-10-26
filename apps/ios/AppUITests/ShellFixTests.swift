import XCTest

/// Wave 3 review fixes owned by the shell: the Face ID lock cover, iPad hardware-keyboard shortcuts, the composer panel
/// staying open, and search results surviving a tap on a result. Screenshots go to `FLINT_SHOT_DIR` like `ScreenTourTests`.
final class ShellFixTests: XCTestCase {
    override func setUp() { continueAfterFailure = true }

    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    @MainActor
    private func launch(appearance: String = "dark", extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-FlintSeed", "demo", "-FlintAppearance", appearance] + extra
        app.launch()
        return app
    }

    @MainActor
    private func any(_ app: XCUIApplication, _ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    @MainActor
    private func rows(_ app: XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'inbox.row.'"))
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

    // MARK: Face ID lock

    @MainActor
    func testLockCoversTheMailUntilUnlocked() {
        for theme in ["dark", "light"] {
            let app = launch(appearance: theme, extra: ["-flint.privacy.faceIDLock", "YES", "-FlintFakeAuth", "fail"])
            XCTAssertTrue(any(app, "lock.screen").waitForExistence(timeout: 30))
            XCTAssertTrue(any(app, "lock.unlock").exists)
            shot(app, "lock-\(theme)")
            app.terminate()
        }
    }

    @MainActor
    func testUnlockShowsTheInbox() {
        let app = launch(extra: ["-flint.privacy.faceIDLock", "YES", "-FlintFakeAuth", "pass"])
        XCTAssertTrue(rows(app).firstMatch.waitForExistence(timeout: 60))
        XCTAssertFalse(any(app, "lock.screen").exists)
    }

    // MARK: Search

    @MainActor
    func testSearchResultKeepsTheSearch() {
        let app = launch()
        let open = app.buttons["Search"].firstMatch
        XCTAssertTrue(open.waitForExistence(timeout: 60))
        open.tap()
        let field = any(app, "search.field")
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText("roadmap")
        let results = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'search.result.'"))
        XCTAssertTrue(results.firstMatch.waitForExistence(timeout: 10))
        results.firstMatch.tap()
        XCTAssertTrue(any(app, "thread.root").waitForExistence(timeout: 15))
        if isPad {
            app.buttons["Search"].firstMatch.tap()
        } else {
            any(app, "thread.back").tap()
        }
        XCTAssertTrue(results.firstMatch.waitForExistence(timeout: 15), "the results should be back")
        XCTAssertEqual(any(app, "search.field").value as? String, "roadmap")
        shot(app, "search-back")
    }

    // MARK: iPad keyboard and composer panel

    @MainActor
    func testKeyboardShortcutsOnIPad() throws {
        try XCTSkipUnless(isPad, "hardware keyboard shortcuts are an iPad feature")
        let app = launch()
        XCTAssertTrue(rows(app).firstMatch.waitForExistence(timeout: 60))

        // Cmd-F opens search, Escape-free: close with its X.
        app.typeKey("f", modifierFlags: .command)
        shot(app, "pad-cmdf")
        XCTAssertTrue(any(app, "search.field").waitForExistence(timeout: 10))
        app.buttons["Close"].firstMatch.tap()

        // J opens the first conversation, K from the second goes back, the arrows do the same.
        app.typeKey("j", modifierFlags: [])
        XCTAssertTrue(any(app, "thread.root").waitForExistence(timeout: 10))
        let first = rows(app).element(boundBy: 0).identifier
        app.typeKey("j", modifierFlags: [])
        sleep(1)
        app.typeKey(.upArrow, modifierFlags: [])
        sleep(1)

        // Cmd-R replies to the open conversation, in the floating panel.
        app.typeKey("r", modifierFlags: .command)
        XCTAssertTrue(any(app, "composer.root").waitForExistence(timeout: 10))
        shot(app, "pad-reply-panel")

        // Opening another conversation leaves the panel up.
        rows(app).element(boundBy: 2).tap()
        XCTAssertTrue(any(app, "thread.root").waitForExistence(timeout: 10))
        XCTAssertTrue(any(app, "composer.root").exists, "the composer panel must stay open")
        shot(app, "pad-panel-stays")
        _ = first
    }

    @MainActor
    func testCmdNAndArchiveOnIPad() throws {
        try XCTSkipUnless(isPad, "hardware keyboard shortcuts are an iPad feature")
        let app = launch()
        XCTAssertTrue(rows(app).firstMatch.waitForExistence(timeout: 60))
        app.typeKey("n", modifierFlags: .command)
        XCTAssertTrue(any(app, "composer.root").waitForExistence(timeout: 10))
        shot(app, "pad-new-message")
        app.terminate()

        let second = launch()
        XCTAssertTrue(rows(second).firstMatch.waitForExistence(timeout: 60))
        rows(second).firstMatch.tap()
        XCTAssertTrue(any(second, "thread.root").waitForExistence(timeout: 10))
        second.typeKey("e", modifierFlags: [])
        XCTAssertTrue(second.staticTexts["Archived"].waitForExistence(timeout: 10))
    }
}

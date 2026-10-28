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

    /// Types a shortcut and waits for `result`, pressing again when nothing happened. The first key with a modifier that a
    /// relaunched app gets from the runner is lost (the simulator attaches its hardware keyboard to the new process only
    /// then): the shortcut worked on the first launch of a test session and failed on every later one, with Cmd-N and Cmd-F
    /// alike, and a second press always worked. The app's key commands are not at fault.
    @MainActor
    private func press(_ app: XCUIApplication, _ key: String, _ flags: XCUIElement.KeyModifierFlags, expecting result: String, timeout: TimeInterval = 4) -> Bool {
        for _ in 0..<4 {
            app.typeKey(key, modifierFlags: flags)
            if any(app, result).waitForExistence(timeout: timeout) { return true }
        }
        return false
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

    // MARK: Read statuses entries

    @MainActor
    func testSidebarOpensReadStatuses() {
        let app = launch(extra: ["-FlintRoute", "sidebar"])
        let row = app.buttons["sidebar.receipts"]
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        row.tap()
        XCTAssertTrue(any(app, "receipts.root").waitForExistence(timeout: 15))
        let list = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'receipts.row.'"))
        XCTAssertTrue(list.firstMatch.waitForExistence(timeout: 10))
        shot(app, "receipts-from-sidebar")
    }

    @MainActor
    func testSettingsReceiptsPageLinksToStatusesAndExplains() {
        for theme in ["dark", "light"] {
            let app = launch(appearance: theme, extra: ["-FlintRoute", "settings"])
            let section = any(app, "settings.section.receipts")
            XCTAssertTrue(section.waitForExistence(timeout: 30))
            if !section.isHittable { app.swipeUp() }
            section.tap()
            XCTAssertTrue(any(app, "settings.receipts.root").waitForExistence(timeout: 10))
            var text = any(app, "receipts.howItWorks.text")
            for _ in 0..<4 where !text.exists { app.swipeUp() }
            text = any(app, "receipts.howItWorks.text")
            XCTAssertTrue(text.exists, "the desktop's How it works text")
            shot(app, "settings-receipts-\(theme)")
            for _ in 0..<4 where !any(app, "settings.receipts.statuses").isHittable { app.swipeDown() }
            let link = any(app, "settings.receipts.statuses")
            XCTAssertTrue(link.waitForExistence(timeout: 5))
            link.tap()
            XCTAssertTrue(any(app, "receipts.root").waitForExistence(timeout: 15))
            app.terminate()
        }
    }

    // MARK: iPad keyboard and composer panel

    @MainActor
    func testKeyboardShortcutsOnIPad() throws {
        try XCTSkipUnless(isPad, "hardware keyboard shortcuts are an iPad feature")
        let app = launch()
        XCTAssertTrue(rows(app).firstMatch.waitForExistence(timeout: 60))

        // Cmd-F opens search, Escape-free: close with its X.
        XCTAssertTrue(press(app, "f", .command, expecting: "search.field"), "Cmd-F should open search")
        shot(app, "pad-cmdf")
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
        XCTAssertTrue(press(app, "r", .command, expecting: "composer.root"), "Cmd-R should open the reply panel")
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
        XCTAssertTrue(press(app, "n", .command, expecting: "composer.root"), "Cmd-N should open a new message")
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

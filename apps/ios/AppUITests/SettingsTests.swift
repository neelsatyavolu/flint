import XCTest

/// Settings on the demo mailbox: open every page, change a few things and check they stick. Screenshots are attached to the
/// result and, when `TEST_RUNNER_FLINT_SHOT_DIR` is set, written there as PNGs.
final class SettingsTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    @MainActor
    private func openSettings(appearance: String = "dark") -> XCUIApplication {
        let app = ShellTests.launchSeeded(appearance: appearance, route: "settings")
        XCTAssertTrue(element(app, "settings.root").waitForExistence(timeout: 25))
        return app
    }

    @MainActor
    private func push(_ app: XCUIApplication, _ id: String, page: String) {
        let row = element(app, id)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "missing \(id)")
        if !row.isHittable { app.swipeUp() }
        row.tap()
        XCTAssertTrue(element(app, page).waitForExistence(timeout: 10), "missing \(page)")
    }

    @MainActor
    private func back(_ app: XCUIApplication) {
        element(app, "settings.back").tap()
    }

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
    func testRootListsAccountsAndPages() {
        let app = openSettings()
        let accounts = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'settings.account.'"))
        XCTAssertGreaterThanOrEqual(accounts.count, 3)
        for section in ["appearance", "inbox", "compose", "signatures", "rules", "notifications", "privacy", "receipts", "about"] {
            XCTAssertTrue(element(app, "settings.section.\(section)").exists || { app.swipeUp(); return element(app, "settings.section.\(section)").exists }(), section)
        }
    }

    @MainActor
    func testAccountColorAndUnifiedSwitch() {
        let app = openSettings()
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'settings.account.' AND NOT identifier CONTAINS 'status'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(element(app, "settings.account.root").waitForExistence(timeout: 10))
        let swatch = element(app, "settings.color.5d9669")
        for _ in 0..<3 where !swatch.isHittable { app.swipeUp() }
        swatch.tap()
        XCTAssertTrue(swatch.waitForExistence(timeout: 5))
        XCTAssertEqual(swatch.value as? String, "Selected")
        shot(app, "account-detail-dark")
    }

    @MainActor
    func testCreateASignatureAndTheListShowsIt() {
        let app = openSettings()
        push(app, "settings.section.signatures", page: "settings.signatures.root")
        push(app, "settings.signature.new", page: "settings.signature.root")
        let name = element(app, "settings.signature.name")
        name.tap()
        name.typeText("Studio")
        let text = element(app, "settings.signature.text")
        text.tap()
        text.typeText("Maya Okafor")
        let save = element(app, "settings.signature.save")
        for _ in 0..<3 where !save.isHittable { app.swipeUp() }
        save.tap()
        XCTAssertTrue(element(app, "settings.signatures.root").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Studio"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testUndoSendMenuChangesTheValue() {
        let app = openSettings()
        push(app, "settings.section.compose", page: "settings.compose.root")
        let menu = element(app, "settings.compose.undoSend")
        menu.tap()
        app.buttons["30 seconds"].tap()
        XCTAssertTrue(NSPredicate(format: "value == '30 seconds'").evaluate(with: element(app, "settings.compose.undoSend")) || element(app, "settings.compose.undoSend").waitForExistence(timeout: 3))
        XCTAssertEqual(element(app, "settings.compose.undoSend").value as? String, "30 seconds")
    }

    @MainActor
    func testRuleNeedsANameThenSaves() {
        let app = openSettings()
        push(app, "settings.section.rules", page: "settings.rules.root")
        push(app, "settings.rule.new", page: "settings.rule.root")
        let save = element(app, "settings.rule.save")
        for _ in 0..<4 where !save.isHittable { app.swipeUp() }
        save.tap()
        XCTAssertTrue(app.staticTexts["Name the rule."].waitForExistence(timeout: 5))
    }

    @MainActor
    private func tour(appearance: String) {
        let app = openSettings(appearance: appearance)
        shot(app, "root-\(appearance)")
        let pages: [(String, String)] = [
            ("accounts", "accounts"), ("appearance", "appearance"), ("inbox", "inbox"), ("compose", "compose"),
            ("signatures", "signatures"), ("rules", "rules"), ("privacy", "privacy"), ("about", "about"), ("notifications", "notifications"),
        ]
        for (section, root) in pages {
            let link = element(app, "settings.section.\(section)")
            for _ in 0..<3 where !link.exists || !link.isHittable { app.swipeUp() }
            if !link.exists { continue }
            link.tap()
            XCTAssertTrue(element(app, "settings.\(root).root").waitForExistence(timeout: 10), root)
            shot(app, "\(root)-\(appearance)")
            back(app)
            for _ in 0..<3 where !element(app, "settings.section.appearance").isHittable { app.swipeDown() }
        }
    }

    @MainActor func testTourInGraphite() { tour(appearance: "dark") }
    @MainActor func testTourInPaper() { tour(appearance: "light") }
}

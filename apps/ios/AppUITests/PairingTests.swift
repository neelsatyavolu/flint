import XCTest

/// The pairing flow on the demo mailbox, from Settings > Devices through the in-app demo Mac: code, review, add, done.
/// Screenshots go to FLINT_SHOT_DIR when it is set (the same convention as ScreenTourTests).
final class PairingTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    @MainActor
    private func shot(_ name: String) {
        sleep(1)
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let env = ProcessInfo.processInfo.environment
        guard let dir = env["FLINT_SHOT_DIR"] else { return }
        let prefix = env["FLINT_SHOT_PREFIX"] ?? (UIDevice.current.userInterfaceIdiom == .pad ? "pad" : "phone")
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)-pairing-\(name).png"))
    }

    @MainActor
    private func runMainPath(appearance: String) {
        let app = ShellTests.launchSeeded(appearance: appearance, route: "settings")
        let devices = element(app, "settings.section.devices")
        XCTAssertTrue(devices.waitForExistence(timeout: 30))
        devices.tap()
        let setup = element(app, "devices.setup")
        XCTAssertTrue(setup.waitForExistence(timeout: 10))
        shot("\(appearance)-1-devices")
        setup.tap()

        XCTAssertTrue(element(app, "pairing.intro.title").waitForExistence(timeout: 10))
        shot("\(appearance)-2-intro")
        element(app, "pairing.scan").tap()
        let demo = element(app, "pairing.demo")
        XCTAssertTrue(demo.waitForExistence(timeout: 10), "the simulator has no camera, so the demo Mac is offered")
        shot("\(appearance)-3-scan")
        demo.tap()

        let code = element(app, "pairing.code")
        XCTAssertTrue(code.waitForExistence(timeout: 15))
        shot("\(appearance)-4-code")

        XCTAssertTrue(element(app, "pairing.review.title").waitForExistence(timeout: 20))
        XCTAssertTrue(element(app, "pairing.signin.demo.home@gmail.com").exists, "Google arrives as a Sign in row")
        shot("\(appearance)-5-review")
        element(app, "pairing.signin.demo.home@gmail.com").tap()
        XCTAssertTrue(element(app, "pairing.account.demo.home@gmail.com").waitForExistence(timeout: 15), "the signed-in row becomes an account row")
        app.swipeUp()
        let receipts = element(app, "pairing.receipts.toggle")
        XCTAssertTrue(receipts.waitForExistence(timeout: 5), "the Mac's receipts service has its own switch")
        XCTAssertEqual(element(app, "pairing.settings.toggle").value as? String, "1")
        XCTAssertEqual(receipts.value as? String, "0", "receipts stay off until the person turns them on")
        shot("\(appearance)-5b-review-receipts")
        element(app, "pairing.import").tap()

        XCTAssertTrue(element(app, "pairing.done.summary").waitForExistence(timeout: 20))
        XCTAssertTrue(element(app, "pairing.done.summary").label.contains("Added 2 accounts"))
        shot("\(appearance)-6-done")
        element(app, "pairing.done").tap()
        XCTAssertTrue(element(app, "devices.setup").waitForExistence(timeout: 10))
    }

    @MainActor func testMainPathGraphite() { runMainPath(appearance: "dark") }
    @MainActor func testMainPathPaper() { runMainPath(appearance: "light") }

    /// Accounts already on the iPhone: every row shows both servers, a changed host asks for the password again, and a changed
    /// port goes through a login check.
    @MainActor
    private func runExistingAccounts(appearance: String) {
        let app = XCUIApplication()
        app.launchArguments += ["-FlintSeed", "demo", "-FlintAppearance", appearance, "-FlintRoute", "settings", "-FlintPairingExisting"]
        app.launch()
        element(app, "settings.section.devices").tap()
        element(app, "devices.setup").tap()
        element(app, "pairing.scan").tap()
        element(app, "pairing.demo").tap()
        XCTAssertTrue(element(app, "pairing.review.title").waitForExistence(timeout: 25))

        let servers = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'SMTP smtp.example.com, port 465, TLS'"))
        XCTAssertGreaterThanOrEqual(servers.count, 3, "ready, conflict and pending rows all show the SMTP server with port and TLS")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'IMAP imap.example.com, port 143, no TLS'")).firstMatch.exists, "a server without TLS says so")
        XCTAssertTrue(element(app, "pairing.replace.demo.edge@example.com").exists, "a port change keeps the switch")
        XCTAssertFalse(element(app, "pairing.replace.demo.office@example.com").exists, "a host change has no switch")
        shot("\(appearance)-8-review-existing")

        element(app, "pairing.signin.demo.office@example.com").tap()
        let field = element(app, "pairing.password.demo.office@example.com")
        XCTAssertTrue(field.waitForExistence(timeout: 5), "switching hosts asks for the password again")
        shot("\(appearance)-9-switch-password")
        field.tap()
        field.typeText("typed-password")
        element(app, "pairing.password.add.demo.office@example.com").tap()
        XCTAssertTrue(element(app, "pairing.account.demo.office@example.com").waitForExistence(timeout: 15))
        XCTAssertFalse(element(app, "pairing.signin.demo.office@example.com").exists)
    }

    @MainActor func testExistingAccountsGraphite() { runExistingAccounts(appearance: "dark") }
    @MainActor func testExistingAccountsPaper() { runExistingAccounts(appearance: "light") }

    @MainActor
    func testCancelAtTheCodeReturnsToTheStart() {
        let app = ShellTests.launchSeeded(route: "settings")
        element(app, "settings.section.devices").tap()
        element(app, "devices.setup").tap()
        element(app, "pairing.scan").tap()
        element(app, "pairing.demo").tap()
        XCTAssertTrue(element(app, "pairing.code").waitForExistence(timeout: 15))
        element(app, "pairing.cancel").tap()
        XCTAssertTrue(element(app, "pairing.intro.title").waitForExistence(timeout: 10))
    }

    /// A flint://pair link from outside the app waits for a tap before it connects. iOS asks "Open in Flint?" first.
    @MainActor
    private func runLinkConfirm(appearance: String) {
        let object = #"{"v":1,"sid":"AQEBAQEBAQEBAQEBAQEBAQ","pk":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI","addrs":["192.168.1.20"],"port":49152}"#
        let payload = Data(object.utf8).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let app = ShellTests.launchSeeded(appearance: appearance, route: "onboarding")
        XCTAssertTrue(element(app, "onboarding.mac").waitForExistence(timeout: 30))
        app.open(URL(string: "flint://pair#\(payload)")!)
        let open = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Open"]
        if open.waitForExistence(timeout: 5) { open.tap() }
        XCTAssertTrue(element(app, "pairing.link.title").waitForExistence(timeout: 15))
        XCTAssertEqual(element(app, "pairing.link.hosts").label, "192.168.1.20")
        XCTAssertFalse(element(app, "pairing.code").exists)
        XCTAssertFalse(element(app, "pairing.connecting").exists, "nothing connects before Connect")
        shot("\(appearance)-7-link-confirm")
        element(app, "pairing.link.cancel").tap()
        XCTAssertTrue(element(app, "pairing.intro.title").waitForExistence(timeout: 10))
    }

    @MainActor func testLinkConfirmGraphite() { runLinkConfirm(appearance: "dark") }
    @MainActor func testLinkConfirmPaper() { runLinkConfirm(appearance: "light") }

    @MainActor
    func testOnboardingRowOpensPairing() {
        let app = ShellTests.launchSeeded(route: "onboarding")
        let row = element(app, "onboarding.mac")
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        XCTAssertTrue(row.isEnabled)
        row.tap()
        XCTAssertTrue(element(app, "pairing.intro.title").waitForExistence(timeout: 10))
    }
}

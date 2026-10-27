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
        element(app, "pairing.import").tap()

        XCTAssertTrue(element(app, "pairing.done.summary").waitForExistence(timeout: 20))
        XCTAssertTrue(element(app, "pairing.done.summary").label.contains("Added 2 accounts"))
        shot("\(appearance)-6-done")
        element(app, "pairing.done").tap()
        XCTAssertTrue(element(app, "devices.setup").waitForExistence(timeout: 10))
    }

    @MainActor func testMainPathGraphite() { runMainPath(appearance: "dark") }
    @MainActor func testMainPathPaper() { runMainPath(appearance: "light") }

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

import XCTest

/// The Dynamic Type pass at AX3 (the Settings app's Larger Text slider, `ScreenTourTests.ax3`) on the screens `testLargeText`
/// in `ScreenTourTests` does not cover: the sidebar, search, settings, onboarding and a settings page. Each screen is saved as a
/// screenshot and its primary controls must still take taps (nothing pushed off screen or under another view). The audit at AX3
/// is in the extension below.
final class LargeTextTests: XCTestCase {
    override func setUp() { continueAfterFailure = true }

    private let screens: [(route: String, id: String, name: String, controls: [String])] = [
        ("sidebar", "sidebar.root", "sidebar", ["sidebar.row.inbox", "sidebar.settings"]),
        ("search:roadmap", "search.root", "search", ["search.field"]),
        ("settings", "settings.root", "settings", ["settings.header"]),
        ("settings:appearance", "settings.appearance.root", "settings-appearance", ["settings.back", "settings.appearance.theme"]),
        ("onboarding", "onboarding.root", "onboarding", ["onboarding.google", "onboarding.other"]),
    ]

    @MainActor
    func testScreensAtAX3KeepTheirControlsReachable() {
        for theme in ["dark", "light"] {
            for screen in screens {
                let app = ScreenTourTests.launch(appearance: theme, route: screen.route, textSize: ScreenTourTests.ax3)
                ScreenTourTests.revealPadSidebar(app, id: screen.id)
                XCTAssertTrue(app.descendants(matching: .any)[screen.id].firstMatch.waitForExistence(timeout: 30), "\(screen.name) \(theme)")
                sleep(2)
                let screenshot = XCUIScreen.main.screenshot()
                let shot = XCTAttachment(screenshot: screenshot)
                shot.name = "ax3-\(screen.name)-\(theme)"
                shot.lifetime = .keepAlways
                add(shot)
                if let dir = ProcessInfo.processInfo.environment["FLINT_SHOT_DIR"] {
                    let prefix = UIDevice.current.userInterfaceIdiom == .pad ? "pad" : "phone"
                    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
                    try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)-ax3-\(screen.name)-\(theme).png"))
                }
                for control in screen.controls {
                    let element = app.descendants(matching: .any)[control].firstMatch
                    // A sheet can still be settling, so give a control a few seconds to take taps.
                    for _ in 0..<10 where !element.isHittable { usleep(500_000) }
                    XCTAssertTrue(element.exists && element.isHittable, "\(control) on \(screen.name) at AX3 (\(theme))")
                }
                app.terminate()
            }
        }
    }
}

/// The audit at AX3 and in Paper, one test per screen, with the skips and the reasons from `AccessibilityAuditTests`.
extension AccessibilityAuditTests {
    @MainActor func testInboxAX3() throws { try audit(route: nil, waitFor: "inbox.root", textSize: ScreenTourTests.ax3) }
    @MainActor func testThreadAX3() throws { try audit(route: "thread:Q4 roadmap", waitFor: "thread.root", textSize: ScreenTourTests.ax3, checksClipping: false) }
    @MainActor func testSidebarAX3() throws { try audit(route: "sidebar", waitFor: "sidebar.root", textSize: ScreenTourTests.ax3) }
    @MainActor func testSearchAX3() throws { try audit(route: "search:roadmap", waitFor: "search.root", textSize: ScreenTourTests.ax3, checksClipping: false) }
    @MainActor func testSettingsAX3() throws { try audit(route: "settings", waitFor: "settings.root", textSize: ScreenTourTests.ax3) }
    @MainActor func testOnboardingAX3() throws { try audit(route: "onboarding", waitFor: "onboarding.root", textSize: ScreenTourTests.ax3) }
    @MainActor func testThreadPaper() throws { try audit(route: "thread:Q4 roadmap", waitFor: "thread.root", appearance: "light", checksClipping: false) }
    @MainActor func testSidebarPaper() throws { try audit(route: "sidebar", waitFor: "sidebar.root", appearance: "light") }
    @MainActor func testSettingsPaper() throws { try audit(route: "settings", waitFor: "settings.root", appearance: "light") }
    @MainActor func testSearchPaper() throws { try audit(route: "search:roadmap", waitFor: "search.root", appearance: "light", checksClipping: false) }
    @MainActor func testComposerPaper() throws { try audit(route: "compose", waitFor: "composer.root", appearance: "light") }
    @MainActor func testOnboardingPaper() throws { try audit(route: "onboarding", waitFor: "onboarding.root", appearance: "light") }
}

import XCTest

/// Stub for Wave 5's UI suite: launches to the theme gallery in Graphite and Paper and attaches screenshots
/// for human review. Run with `xcodebuild test -only-testing:FlintUITests` (see PLAN.md section 11).
final class ThemeGalleryLaunchTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    private func launch(appearance: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-FlintThemeGallery", "YES", "-FlintAppearance", appearance]
        app.launch()
        return app
    }

    @MainActor
    private func check(_ appearance: String) {
        let app = launch(appearance: appearance)
        XCTAssertTrue(app.otherElements["gallery.root"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["gallery.cycle"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "gallery-\(appearance)"
        shot.lifetime = .keepAlways
        add(shot)
    }

    @MainActor func testGalleryInGraphite() { check("dark") }
    @MainActor func testGalleryInPaper() { check("light") }
}

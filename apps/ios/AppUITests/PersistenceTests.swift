import XCTest

/// Settings that must survive a relaunch. The demo mailbox is a throwaway database, so only the device-level choices persist
/// there (the theme lives in UserDefaults). The mailbox settings are written to the database, which a plain launch (no seed)
/// opens in this simulator's own sandbox, never in any real data.
final class PersistenceTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// Launches without `-FlintAppearance`, so the stored theme is what shows.
    @MainActor
    private func launch(seed: Bool, route: String) -> XCUIApplication {
        let app = XCUIApplication()
        if seed { app.launchArguments += ["-FlintSeed", "demo"] }
        app.launchArguments += ["-FlintRoute", route]
        app.launch()
        return app
    }

    @MainActor
    private func choose(_ app: XCUIApplication, menu id: String, option: String) {
        let menu = element(app, id)
        XCTAssertTrue(menu.waitForExistence(timeout: 25), id)
        menu.tap()
        let choice = app.buttons[option]
        XCTAssertTrue(choice.waitForExistence(timeout: 5), option)
        choice.tap()
        XCTAssertEqual(element(app, id).value as? String, option)
    }

    @MainActor
    func testThemeChoiceSurvivesARelaunch() {
        var app = launch(seed: true, route: "settings:appearance")
        choose(app, menu: "settings.appearance.theme", option: "Paper")
        app.terminate()

        app = launch(seed: true, route: "settings:appearance")
        let menu = element(app, "settings.appearance.theme")
        XCTAssertTrue(menu.waitForExistence(timeout: 25))
        XCTAssertEqual(menu.value as? String, "Paper", "the theme stays after a relaunch")
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "theme-paper-after-relaunch"
        shot.lifetime = .keepAlways
        add(shot)

        // Put it back so later runs start from the default.
        choose(app, menu: "settings.appearance.theme", option: "System")
        app.terminate()
    }

    @MainActor
    func testMailboxSettingSurvivesARelaunch() {
        var app = launch(seed: false, route: "settings:compose")
        choose(app, menu: "settings.compose.undoSend", option: "30 seconds")
        // Settings are saved as they change; give the database write a moment before the process ends.
        sleep(2)
        app.terminate()

        app = launch(seed: false, route: "settings:compose")
        let menu = element(app, "settings.compose.undoSend")
        XCTAssertTrue(menu.waitForExistence(timeout: 25))
        XCTAssertEqual(menu.value as? String, "30 seconds", "the undo-send delay stays after a relaunch")

        choose(app, menu: "settings.compose.undoSend", option: "10 seconds")
        sleep(2)
        app.terminate()
    }
}

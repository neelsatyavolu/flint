import XCTest

/// End to end against GreenMail on this Mac: add an Other email account, read, reply and send, archive with undo, snooze, and
/// search. Skipped unless `TEST_RUNNER_FLINT_E2E_SUBJECT` is set; `scripts/e2e-greenmail.sh` starts GreenMail, delivers the
/// two messages this test expects, runs it and then checks the reply reached the other mailbox.
///
/// The app launches without the demo seed, so it starts empty and opens onboarding by itself. Uninstall the app first (the
/// script does) so no account is left from an earlier run.
final class EndToEndTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private var env: [String: String] { ProcessInfo.processInfo.environment }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    @MainActor
    private func row(_ app: XCUIApplication, subject: String) -> XCUIElement {
        let predicate = NSPredicate(format: "identifier BEGINSWITH 'inbox.row.' AND label CONTAINS %@", subject)
        return app.descendants(matching: .any).matching(predicate).firstMatch
    }

    /// Waits for an element to take taps (a sheet may still be closing). On a timeout, saves what the screen shows to
    /// `TEST_RUNNER_FLINT_SHOT_DIR` and prints the element tree, then fails.
    @MainActor
    private func waitHittable(_ app: XCUIApplication, _ element: XCUIElement, _ what: String, timeout: Int = 20) {
        for _ in 0..<(timeout * 2) where !element.isHittable { usleep(500_000) }
        guard !element.isHittable else { return }
        if let dir = env["FLINT_SHOT_DIR"] {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? app.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("e2e-\(what).png"))
        }
        print("E2E not hittable: \(what)\n\(app.debugDescription)")
        XCTFail("\(what) never became hittable")
    }

    /// Return on the keyboard ends editing (the password field submits nothing), so buttons under the keyboard come back.
    @MainActor
    private func hideKeyboard(_ app: XCUIApplication) {
        guard app.keyboards.firstMatch.exists else { return }
        app.typeText("\n")
        _ = app.keyboards.firstMatch.waitForNonExistence(timeout: 3)
    }

    /// iOS offers to save the password after Add; the test declines (the prompt belongs to the app or to SpringBoard).
    @MainActor
    private func declineSavePassword(_ app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for _ in 0..<10 {
            for owner in [app, springboard] where owner.buttons["Not Now"].exists {
                owner.buttons["Not Now"].tap()
                return
            }
            usleep(500_000)
        }
    }

    /// Replaces a text field's contents.
    @MainActor
    private func replace(_ app: XCUIApplication, _ id: String, with text: String) {
        let field = element(app, id)
        XCTAssertTrue(field.waitForExistence(timeout: 10), id)
        for _ in 0..<4 where !field.isHittable { app.swipeUp() }
        field.tap()
        let current = field.value as? String ?? ""
        if !current.isEmpty { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2)) }
        field.typeText(text)
    }

    @MainActor
    private func setToggle(_ app: XCUIApplication, _ id: String, on: Bool) {
        let toggle = element(app, id)
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), id)
        for _ in 0..<4 where !toggle.isHittable { app.swipeUp() }
        if (toggle.value as? String == "1") != on { toggle.switches.firstMatch.exists ? toggle.switches.firstMatch.tap() : toggle.tap() }
    }

    @MainActor
    private func addAccount(_ app: XCUIApplication, imapPort: String, smtpPort: String) {
        let other = app.buttons["onboarding.other"]
        XCTAssertTrue(other.waitForExistence(timeout: 30), "onboarding should open on an empty launch")
        other.tap()
        replace(app, "onboarding.email", with: "alice@test.local")
        XCTAssertTrue(element(app, "onboarding.summary").waitForExistence(timeout: 30))
        // Wait for the lookup to finish ("Servers not found" opens the fields; a guess shows Edit).
        let host = element(app, "onboarding.server.imapHost")
        let edit = app.buttons["onboarding.server.edit"]
        for _ in 0..<60 where !host.exists && !edit.exists { usleep(500_000) }
        if !host.exists { edit.tap() }
        replace(app, "onboarding.server.imapHost", with: "127.0.0.1")
        replace(app, "onboarding.server.imapPort", with: imapPort)
        setToggle(app, "onboarding.server.imapSecure", on: false)
        replace(app, "onboarding.server.smtpHost", with: "127.0.0.1")
        replace(app, "onboarding.server.smtpPort", with: smtpPort)
        setToggle(app, "onboarding.server.smtpSecure", on: false)
        replace(app, "onboarding.server.username", with: "alice")
        replace(app, "onboarding.name", with: "Alice")
        replace(app, "onboarding.password", with: "secret")
        let add = app.buttons["onboarding.add"]
        for _ in 0..<4 where !add.isHittable { app.swipeUp() }
        XCTAssertTrue(add.isEnabled, "Add account should be enabled once the form is complete")
        hideKeyboard(app)
        for _ in 0..<4 where !add.isHittable { app.swipeUp() }
        waitHittable(app, add, "add")
        add.tap()
        let done = app.buttons["onboarding.done"]
        XCTAssertTrue(done.waitForExistence(timeout: 60), app.debugDescription)
        hideKeyboard(app)
        declineSavePassword(app)
        for _ in 0..<4 where !done.isHittable { app.swipeUp() }
        waitHittable(app, done, "done")
        done.tap()
    }

    @MainActor
    private func readAndReply(_ app: XCUIApplication, subject: String) {
        let message = row(app, subject: subject)
        XCTAssertTrue(message.waitForExistence(timeout: 90), "the delivered message should sync into the inbox")
        waitHittable(app, message, "inbox-row")
        message.tap()
        XCTAssertTrue(element(app, "thread.root").waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", subject)).firstMatch.waitForExistence(timeout: 10))
        app.buttons["thread.reply"].tap()
        let body = app.textViews["composer.body"]
        XCTAssertTrue(body.waitForExistence(timeout: 20))
        body.tap()
        body.typeText("Reply from the end to end test.")
        app.buttons["composer.send"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Sending in'")).firstMatch.waitForExistence(timeout: 15))
        // Let the undo window close so the reply really goes out.
        let sent = NSPredicate(format: "exists == false")
        expectation(for: sent, evaluatedWith: app.buttons["toast.undo"])
        waitForExpectations(timeout: 40)
        let back = app.buttons["thread.back"]
        if back.exists { back.tap() }
    }

    @MainActor
    private func archiveWithUndo(_ app: XCUIApplication, subject: String) {
        let message = row(app, subject: subject)
        XCTAssertTrue(message.waitForExistence(timeout: 15))
        message.swipeLeft()
        app.buttons["inbox.swipe.archive"].tap()
        XCTAssertTrue(app.buttons["toast.undo"].waitForExistence(timeout: 5))
        app.buttons["toast.undo"].tap()
        XCTAssertTrue(row(app, subject: subject).waitForExistence(timeout: 15), "Undo should bring the conversation back")
    }

    @MainActor
    private func snooze(_ app: XCUIApplication, subject: String) {
        let message = row(app, subject: subject)
        XCTAssertTrue(message.waitForExistence(timeout: 30))
        message.swipeLeft()
        app.buttons["inbox.swipe.snooze"].tap()
        let tomorrow = app.buttons["inbox.snooze.tomorrow"]
        XCTAssertTrue(tomorrow.waitForExistence(timeout: 5))
        tomorrow.tap()
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: row(app, subject: subject))
        waitForExpectations(timeout: 15)
    }

    @MainActor
    private func search(_ app: XCUIApplication, word: String) {
        app.buttons["Search"].firstMatch.tap()
        let field = element(app, "search.field")
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(word)
        let results = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'search.result.'"))
        XCTAssertTrue(results.firstMatch.waitForExistence(timeout: 15))
    }

    @MainActor
    func testOtherEmailAccountReadReplyArchiveSnoozeSearch() throws {
        guard let subject = env["FLINT_E2E_SUBJECT"], let second = env["FLINT_E2E_SECOND"] else {
            throw XCTSkip("Set TEST_RUNNER_FLINT_E2E_SUBJECT and TEST_RUNNER_FLINT_E2E_SECOND (scripts/e2e-greenmail.sh does).")
        }
        let app = XCUIApplication()
        app.launchArguments += ["-FlintAppearance", "dark"]
        app.launch()
        addAccount(app, imapPort: env["FLINT_E2E_IMAP"] ?? "3144", smtpPort: env["FLINT_E2E_SMTP"] ?? "3025")
        readAndReply(app, subject: subject)
        archiveWithUndo(app, subject: subject)
        snooze(app, subject: second)
        search(app, word: env["FLINT_E2E_WORD"] ?? subject)
    }
}

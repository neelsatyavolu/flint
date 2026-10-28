import XCTest

/// Whole actions on the demo mailbox, end to end through the in-memory server: reply and send (from the Work account, an
/// ordinary IMAP one, so Flint files the Sent copy itself; Gmail files it server side, which the fake does not do),
/// archive with undo (the row comes back), and the search operators (counts that must add up). Navigation-only checks live in
/// the per-feature test files.
final class FlowTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    @MainActor
    private func rows(_ app: XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'inbox.row.'"))
    }

    @MainActor
    private func results(_ app: XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'search.result.'"))
    }

    // MARK: Reply and send

    @MainActor
    func testReplyIsSentAndLandsInSent() {
        let app = ShellTests.launchSeeded(route: "thread:Mentoring session notes")
        let reply = app.buttons["thread.reply"]
        XCTAssertTrue(reply.waitForExistence(timeout: 30))
        reply.tap()
        let body = app.textViews["composer.body"]
        XCTAssertTrue(body.waitForExistence(timeout: 20))
        body.tap()
        body.typeText("Flow test reply.")
        app.buttons["composer.send"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Sending in'")).firstMatch.waitForExistence(timeout: 15))
        // Once the undo window closes the message really goes out to the in-memory server.
        XCTAssertTrue(app.buttons["toast.undo"].waitForNonExistence(timeout: 45), "the undo window should close")

        let back = app.buttons["thread.back"]
        if back.waitForExistence(timeout: 5) { back.tap() }
        let open = app.buttons["Search"].firstMatch
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        open.tap()
        let field = element(app, "search.field")
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        field.tap()
        field.typeText("in:sent Mentoring")
        XCTAssertTrue(results(app).firstMatch.waitForExistence(timeout: 45), "the sent reply should be found in Sent")
    }

    // MARK: Archive and undo

    @MainActor
    func testArchiveThenUndoBringsTheRowBack() {
        let app = ShellTests.launchSeeded()
        let first = rows(app).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 30))
        let id = first.identifier
        first.swipeLeft()
        let archive = app.buttons["inbox.swipe.archive"]
        XCTAssertTrue(archive.waitForExistence(timeout: 5))
        archive.tap()
        let gone = element(app, id)
        XCTAssertTrue(gone.waitForNonExistence(timeout: 10), "an archived conversation leaves the inbox")
        let undo = app.buttons["toast.undo"]
        XCTAssertTrue(undo.waitForExistence(timeout: 5))
        undo.tap()
        XCTAssertTrue(element(app, id).waitForExistence(timeout: 15), "Undo should bring the conversation back")
    }

    // MARK: Search operators

    /// Types a query and returns how many results settle (0 when "No matches" shows).
    @MainActor
    private func count(_ app: XCUIApplication, _ query: String) -> Int {
        let field = element(app, "search.field")
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        if element(app, "search.clear").exists { element(app, "search.clear").tap(); field.tap() }
        field.typeText(query)
        let outcome = NSPredicate(format: "exists == true")
        let any = element(app, "search.count")
        let none = element(app, "search.empty")
        for _ in 0..<40 where !(outcome.evaluate(with: any) || outcome.evaluate(with: none)) { usleep(250_000) }
        sleep(1)
        if none.exists { return 0 }
        // The rows are lazy, so the count label is the truthful number ("3 results", "1 result").
        let digits = any.label.prefix { $0.isNumber }
        return Int(digits) ?? -1
    }

    @MainActor
    func testSearchOperatorsNarrowAndAddUp() {
        let app = ShellTests.launchSeeded(route: "search")
        let all = count(app, "roadmap")
        XCTAssertGreaterThan(all, 0, "the demo mailbox has roadmap mail")
        let unread = count(app, "roadmap is:unread")
        let read = count(app, "roadmap is:read")
        // A conversation with both read and unread messages can match both, so the parts cover the whole without being disjoint.
        XCTAssertLessThanOrEqual(unread, all)
        XCTAssertLessThanOrEqual(read, all)
        XCTAssertGreaterThanOrEqual(unread + read, all, "is:unread and is:read together cover the results")
        XCTAssertEqual(count(app, "roadmap -roadmap"), 0, "a negated word removes what the word found")
        XCTAssertEqual(count(app, "subject:\"Q4 roadmap\"") > 0, true, "a quoted phrase after subject:")
        XCTAssertGreaterThan(count(app, "has:attachment"), 0, "the demo mailbox has attachments")
        XCTAssertLessThan(count(app, "from:zzqxnobody"), 1)
        XCTAssertGreaterThan(count(app, "in:inbox"), 0)
        // The chips build the same queries.
        let field = element(app, "search.field")
        field.tap()
        element(app, "search.clear").tap()
        field.typeText("roadmap")
        _ = results(app).firstMatch.waitForExistence(timeout: 10)
        app.buttons["search.chip.is:unread"].tap()
        XCTAssertTrue((field.value as? String ?? "").contains("is:unread"))
        app.buttons["search.chip.is:unread"].tap()
        XCTAssertFalse((field.value as? String ?? "").contains("is:unread"), "a second tap removes the chip's operator")
    }

    @MainActor
    func testSearchOperatorScreenshotsInBothThemes() {
        for theme in ["dark", "light"] {
            let app = ShellTests.launchSeeded(appearance: theme, route: "search")
            _ = count(app, "roadmap is:unread")
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = "search-operators-\(theme)"
            shot.lifetime = .keepAlways
            add(shot)
        }
    }
}

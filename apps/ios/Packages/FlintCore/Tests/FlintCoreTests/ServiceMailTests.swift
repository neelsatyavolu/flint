import FlintMail
import FlintModel
import FlintStore
import Foundation
import Testing
@testable import FlintService

private func inbox(_ extra: (inout ThreadQuery) -> Void = { _ in }) -> ThreadQuery {
    var q = ThreadQuery(view: .inbox)
    extra(&q)
    return q
}

@Suite("Service: reading and lists")
struct ServiceReadingTests {
    @Test func syncedMailIsListedWithItsCategoryAndTheSidebarCounts() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let account = try await rig.addAccount()
        await rig.deliver("Lunch?", ageDays: 1)
        await rig.deliver("Weekly deals", from: "news@shop.example", ageDays: 1, headers: ["list-unsubscribe": "<mailto:u@shop.example>", "list-id": "<offers.shop.example>"])
        try await rig.service.syncNow()

        let page = try await rig.service.listThreads(inbox())
        #expect(Set(page.items.map(\.subject)) == ["Lunch?", "Weekly deals"])
        #expect(page.items.first { $0.subject == "Weekly deals" }?.category == .newsletters)
        #expect(page.items.first { $0.subject == "Lunch?" }?.category == .people)

        let sidebar = try await rig.service.sidebar().first { _ in true }
        #expect(sidebar?.accounts.first?.account.id == account.id)
        #expect(sidebar?.accounts.first?.inboxUnread == 2)
        #expect(sidebar?.accounts.first?.sync.state == .idle)
    }

    @Test func theThreadStreamYieldsNowAndAgainWhenMailArrives() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("first", ageDays: 1)
        try await rig.service.syncNow()
        let stream = rig.service.threads(inbox())
        let initial = await serviceAwait(stream) { $0.items.count == 1 }
        #expect(initial?.items.first?.subject == "first")

        let more = Task { await serviceAwait(rig.service.threads(inbox())) { $0.items.count == 2 } }
        try await Task.sleep(for: .milliseconds(100))
        await rig.deliver("second", ageDays: 1)
        try await rig.service.syncNow()
        #expect(await more.value?.items.count == 2)
    }

    @Test func openingAThreadFetchesAMissingBodyAndSanitizesIt() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        let html = BodyPart(number: "1", type: "text", subtype: "html", parameters: ["charset": "utf-8"], encoding: "7bit", size: 90)
        let envelope = mailTestEnvelope("Old news", ageDays: 30, structure: html)
        await rig.fake.deliver(
            envelope, parts: ["1": Data("<p>Hi</p><script>alert(1)</script><img src=\"https://cdn.example.com/a.png\" width=\"40\" height=\"40\">".utf8)], to: "INBOX")
        try await rig.service.syncNow()

        let id = try #require(try await rig.service.listThreads(inbox()).items.first?.id)
        let detail = try await rig.service.thread(id: id)
        let message = try #require(detail.messages.first)
        #expect(message.bodyLoaded)
        #expect(message.html?.contains("<p>Hi</p>") == true)
        #expect(message.html?.contains("<script") == false)
        #expect(message.remoteImages == .blocked)

        let allowed = try await rig.service.allowRemoteImages(messageId: message.id, always: true)
        #expect(allowed.remoteImages == .allowed)
        // The sender is remembered: a later message from the same address loads its images too.
        let policy = await rig.service.core.imagePolicy(settings: Settings(), for: [try #require(try await rig.store.message(id: message.id))])
        #expect(policy.senders.contains("ann@example.com"))
    }

    @Test func olderMailIsReachableAndTheListSaysSoUntilItIsLoaded() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        for i in 0..<5 { await rig.deliver("old \(i)", ageDays: 400 + Double(i)) }
        await rig.deliver("recent", ageDays: 1)
        try await rig.service.syncNow()

        let first = try await rig.service.listThreads(inbox())
        #expect(first.items.map(\.subject) == ["recent"])
        #expect(first.olderOnServer)

        var loaded = 0
        for _ in 0..<5 {
            let result = try await rig.service.loadOlder(inbox())
            loaded += result.loaded
            if !result.hasMore { break }
        }
        #expect(loaded == 5)
        let after = try await rig.service.listThreads(inbox())
        #expect(after.items.count == 6)
        #expect(!after.olderOnServer)
    }

    @Test func serverSearchBringsInMailThatIsNotOnTheDevice() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("Tax return 2019", from: "bob@example.org", ageDays: 800)
        await rig.deliver("recent", ageDays: 1)
        try await rig.service.syncNow()
        #expect(try await rig.service.listThreads(ThreadQuery(view: .search, search: "Tax")).items.isEmpty)

        let result = try await rig.service.searchServer("Tax")
        #expect(result.found == 1)
        #expect(result.added == 1)
        #expect(try await rig.service.listThreads(ThreadQuery(view: .search, search: "Tax")).items.map(\.subject) == ["Tax return 2019"])
        #expect(try await rig.service.searchServer("in:inbox").found == 0)
    }

    @Test func aMessageViewCarriesTheStoredFlagsAndReceiptSlot() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("flagged", ageDays: 1, flags: ["\\Flagged"])
        try await rig.service.syncNow()
        let id = try #require(try await rig.service.listThreads(inbox()).items.first?.id)
        let view = try #require(try await rig.service.thread(id: id).messages.first)
        #expect(view.pinned)
        #expect(!view.seen)
        #expect(view.receipt == nil)
        #expect(try await rig.service.message(id: view.id).subject == "flagged")
        await #expect(throws: FlintError.self) { _ = try await rig.service.message(id: 999_999) }
        await #expect(throws: FlintError.self) { _ = try await rig.service.thread(id: 999_999) }
    }
}

@Suite("Service: actions")
struct ServiceActionTests {
    private func seeded() async throws -> (ServiceRig, ThreadID) {
        let rig = try await ServiceRig.make()
        try await rig.addAccount()
        await rig.deliver("Plan", ageDays: 1)
        try await rig.service.syncNow()
        let id = try #require(try await rig.service.listThreads(inbox()).items.first?.id)
        return (rig, id)
    }

    @Test func archiveMovesTheThreadOnTheServerAndUndoBringsItBack() async throws {
        let (rig, id) = try await seeded()
        defer { Task { await rig.cleanup() } }
        let token = try await rig.service.archive([id])
        #expect(try await rig.service.listThreads(inbox()).items.isEmpty)
        #expect(try await rig.service.listThreads(ThreadQuery(view: .archive)).items.count == 1)
        #expect(await serviceEventually { await rig.fake.envelopes(in: "Archive").count == 1 })
        #expect(await rig.fake.envelopes(in: "INBOX").isEmpty)

        try await rig.service.undo(token)
        #expect(try await rig.service.listThreads(inbox()).items.count == 1)
        #expect(await serviceEventually { await rig.fake.envelopes(in: "INBOX").count == 1 })
        await #expect(throws: FlintError.self) { try await rig.service.undo(token) }
    }

    @Test func markReadSetsSeenLocallyAndOnTheServer() async throws {
        let (rig, id) = try await seeded()
        defer { Task { await rig.cleanup() } }
        _ = try await rig.service.markRead([id], read: true)
        #expect(try await rig.service.listThreads(inbox()).items.first?.unreadCount == 0)
        #expect(await serviceEventually { await rig.fake.envelopes(in: "INBOX").first?.flags.contains("\\Seen") == true })
    }

    @Test func aFailedServerOperationRestoresTheThreadAndSaysSo() async throws {
        let (rig, id) = try await seeded()
        defer { Task { await rig.cleanup() } }
        await rig.fake.failNext("move", with: FlintError(.network, "connection lost"))
        _ = try await rig.service.archive([id])
        #expect(await serviceEventually { rig.log.toasts.contains { $0.contains("Couldn't archive") } })
        #expect(await serviceEventually { (try? await rig.service.listThreads(inbox()).items.count) == 1 })
    }

    @Test func snoozeHidesTheThreadUntilTheSchedulerBringsItBackUnread() async throws {
        let (rig, id) = try await seeded()
        defer { Task { await rig.cleanup() } }
        _ = try await rig.service.markRead([id], read: true)
        _ = try await rig.service.snooze([id], until: rig.clock.now + 3_600_000)
        #expect(try await rig.service.listThreads(inbox()).items.isEmpty)
        #expect(try await rig.service.listThreads(ThreadQuery(view: .snoozed)).items.count == 1)
        let next = await rig.service.runDueWork()
        #expect(next == rig.clock.now + 3_600_000)
        #expect(try await rig.service.listThreads(inbox()).items.isEmpty)

        rig.clock.advance(3_700_000)
        _ = await rig.service.runDueWork()
        let back = try await rig.service.listThreads(inbox()).items
        #expect(back.count == 1)
        #expect(back.first?.unreadCount == 1)
        #expect(try await rig.service.listThreads(ThreadQuery(view: .snoozed)).items.isEmpty)
    }

    @Test func muteAndPinAreLocalOrFlaggedAndUndoable() async throws {
        let (rig, id) = try await seeded()
        defer { Task { await rig.cleanup() } }
        let pin = try await rig.service.setPinned([id], pinned: true)
        #expect(try await rig.service.listThreads(ThreadQuery(view: .pinned)).items.count == 1)
        try await rig.service.undo(pin)
        #expect(try await rig.service.listThreads(ThreadQuery(view: .pinned)).items.isEmpty)
        _ = try await rig.service.setMuted([id], muted: true)
        #expect(try await rig.service.listThreads(inbox()).items.first?.muted == true)
        await #expect(throws: FlintError.self) { _ = try await rig.service.archive([0]) }
    }

    @Test func trashAndSpamMoveToTheirFoldersEvenWhenTheServerHadNone() async throws {
        let (rig, id) = try await seeded()
        defer { Task { await rig.cleanup() } }
        _ = try await rig.service.markSpam([id], spam: true)
        #expect(try await rig.service.listThreads(ThreadQuery(view: .spam)).items.count == 1)
        _ = try await rig.service.markSpam([id], spam: false)
        #expect(try await rig.service.listThreads(inbox()).items.count == 1)
        _ = try await rig.service.trash([id])
        #expect(try await rig.service.listThreads(ThreadQuery(view: .trash)).items.count == 1)
    }

    @Test func filingUnderACategoryCanRememberTheSenderAndUndoForgetsIt() async throws {
        let (rig, id) = try await seeded()
        defer { Task { await rig.cleanup() } }
        let token = try await rig.service.setCategory([id], .notifications, rememberSender: true)
        #expect(try await rig.service.listThreads(inbox()).items.first?.category == .notifications)
        let rules = try await rig.service.listRules()
        #expect(rules.count == 1)
        #expect(rules.first?.conditions == [RuleCondition(field: .from, op: .equals, value: "ann@example.com")])
        #expect(rules.first?.actions == [.category(.notifications)])

        try await rig.service.undo(token)
        #expect(try await rig.service.listRules().isEmpty)
        #expect(try await rig.service.listThreads(inbox()).items.first?.category == .people)

        // Filing without remembering leaves the rules alone.
        _ = try await rig.service.setCategory([id], .newsletters)
        #expect(try await rig.service.listRules().isEmpty)
    }

    @Test func blockingASenderTrashesTheirMailAndUnblockingRestoresIt() async throws {
        let (rig, _) = try await seeded()
        defer { Task { await rig.cleanup() } }
        try await rig.service.blockSender("Ann@Example.com")
        #expect(try await rig.service.listBlocked().map(\.pattern) == ["ann@example.com"])
        #expect(try await rig.service.listThreads(inbox()).items.isEmpty)
        #expect(try await rig.service.listThreads(ThreadQuery(view: .blocked)).items.count == 1)

        try await rig.service.unblockSender("ann@example.com")
        #expect(try await rig.service.listBlocked().isEmpty)
        #expect(try await rig.service.listThreads(inbox()).items.count == 1)
        await #expect(throws: FlintError.self) { try await rig.service.unblockSender("not an address") }
    }

    @Test func applyingRulesToExistingMailChangesTheMatchingThreads() async throws {
        let (rig, _) = try await seeded()
        defer { Task { await rig.cleanup() } }
        await rig.deliver("Other thing", from: "zed@example.net", ageDays: 1)
        try await rig.service.syncNow()
        let rule = try await rig.service.saveRule(Rule(
            id: 0, name: "Archive Plan", conditions: [RuleCondition(field: .subject, op: .contains, value: "plan")], actions: [.archive, .markRead]))
        #expect(rule.id > 0)
        let changed = try await rig.service.applyRules(ruleId: rule.id)
        #expect(changed == 1)
        #expect(try await rig.service.listThreads(inbox()).items.map(\.subject) == ["Other thing"])
        #expect(try await rig.service.applyRules() == 0)
        await #expect(throws: FlintError.self) { _ = try await rig.service.applyRules(ruleId: 4242) }
    }

    @Test func aBadRulePatternIsRefusedWithAReadableMessage() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let bad = Rule(id: 0, name: "bad", conditions: [RuleCondition(field: .subject, op: .matches, value: "(unclosed")], actions: [.pin])
        do {
            _ = try await rig.service.saveRule(bad)
            Issue.record("expected a refusal")
        } catch let error as FlintError {
            #expect(error.code == .invalid)
            #expect(error.message.contains("(unclosed"))
        }
    }
}

@Suite("Service: unsubscribe")
struct ServiceUnsubscribeTests {
    @Test func aMailtoLinkSendsAnEmailFromTheAccount() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("Deals", from: "news@shop.example", ageDays: 1, headers: ["list-unsubscribe": "<mailto:unsub@shop.example?subject=stop>"])
        try await rig.service.syncNow()
        let id = try #require(try await rig.service.listThreads(inbox()).items.first?.id)
        let messageId = try #require(try await rig.service.thread(id: id).messages.first?.id)
        let method = try await rig.service.unsubscribe(messageId: messageId)
        #expect(method == .mailto)
        let sent = try #require(await rig.fake.sentMessages.first)
        #expect(sent.recipients == ["unsub@shop.example"])
        #expect(String(decoding: sent.raw, as: UTF8.self).contains("Subject: stop"))
    }

    @Test func oneClickPostsOnlyToAPublicHttpsAddress() async throws {
        let posts = ServicePostLog()
        let http = HTTPClient(get: { _ in HTTPResponse(status: 404, body: Data()) }, postForm: { url, form in
            posts.add(url)
            #expect(form == ["List-Unsubscribe": "One-Click"])
            return HTTPResponse(status: 200, body: Data())
        })
        let rig = try await ServiceRig.make(http: http)
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("Deals", ageDays: 1, headers: [
            "list-unsubscribe": "<https://93.184.216.34/u/abc>", "list-unsubscribe-post": "List-Unsubscribe=One-Click",
        ])
        await rig.deliver("Local", from: "x@y.example", ageDays: 1, headers: [
            "list-unsubscribe": "<https://192.168.0.5/u/abc>", "list-unsubscribe-post": "List-Unsubscribe=One-Click",
        ])
        try await rig.service.syncNow()
        let items = try await rig.service.listThreads(inbox()).items
        let deals = try #require(items.first { $0.subject == "Deals" })
        let local = try #require(items.first { $0.subject == "Local" })
        let dealsMessage = try #require(try await rig.service.thread(id: deals.id).messages.first)
        let localMessage = try #require(try await rig.service.thread(id: local.id).messages.first)

        #expect(try await rig.service.unsubscribe(messageId: dealsMessage.id) == .oneClick)
        #expect(posts.all.map(\.absoluteString) == ["https://93.184.216.34/u/abc"])
        // A private address is never posted to; the link is handed back for the person to open.
        #expect(try await rig.service.unsubscribe(messageId: localMessage.id) == .browser(URL(string: "https://192.168.0.5/u/abc")!))
        #expect(posts.all.count == 1)
    }

    @Test func oneClickUsesThePostThatDoesNotFollowRedirects() async throws {
        let posts = ServicePostLog()
        let http = HTTPClient(
            get: { _ in HTTPResponse(status: 404, body: Data()) },
            postForm: { _, _ in Issue.record("followed redirects"); return HTTPResponse(status: 200, body: Data()) },
            postFormWithoutRedirects: { url, _ in posts.add(url); return HTTPResponse(status: 307, body: Data()) })
        let rig = try await ServiceRig.make(http: http)
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("Deals", ageDays: 1, headers: [
            "list-unsubscribe": "<https://93.184.216.34/u/abc>", "list-unsubscribe-post": "List-Unsubscribe=One-Click",
        ])
        try await rig.service.syncNow()
        let id = try #require(try await rig.service.listThreads(inbox()).items.first?.id)
        let messageId = try #require(try await rig.service.thread(id: id).messages.first?.id)
        // A redirect is not an acceptance: the link goes back to the person.
        #expect(try await rig.service.unsubscribe(messageId: messageId) == .browser(URL(string: "https://93.184.216.34/u/abc")!))
        #expect(posts.all.count == 1)
    }

    @Test(arguments: ["<mailto:?subject=x>", "<mailto:%20>", "<ftp://list.example.com/u>", "<javascript:alert(1)>"])
    func aHeaderWithNoWebAddressAndNoUsableMailtoIsNotOpenedInTheBrowser(header: String) async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("Deals", ageDays: 1, headers: ["list-unsubscribe": header])
        try await rig.service.syncNow()
        let id = try #require(try await rig.service.listThreads(inbox()).items.first?.id)
        let messageId = try #require(try await rig.service.thread(id: id).messages.first?.id)
        await #expect(throws: FlintError.self) { _ = try await rig.service.unsubscribe(messageId: messageId) }
    }

    @Test func aMessageWithoutTheHeaderHasNothingToUnsubscribeFrom() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("Hi", ageDays: 1)
        try await rig.service.syncNow()
        let id = try #require(try await rig.service.listThreads(inbox()).items.first?.id)
        let messageId = try #require(try await rig.service.thread(id: id).messages.first?.id)
        await #expect(throws: FlintError.self) { _ = try await rig.service.unsubscribe(messageId: messageId) }
    }
}

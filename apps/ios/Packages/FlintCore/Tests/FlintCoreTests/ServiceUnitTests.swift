import FlintMail
import FlintModel
import FlintStore
import Foundation
import Synchronization
import Testing
@testable import FlintService

@Suite("Service event bus")
struct ServiceEventBusTests {
    @Test func listenersGetEventsInOrderAndCanUnsubscribe() {
        let bus = EventBus()
        let seen = Mutex<[String]>([])
        let first = bus.subscribe { if case .toast(_, let m, _) = $0 { seen.withLock { $0.append("a:\(m)") } } }
        _ = bus.subscribe { if case .toast(_, let m, _) = $0 { seen.withLock { $0.append("b:\(m)") } } }
        bus.emit(.toast(.info, message: "1", undoToken: nil))
        first()
        first()
        bus.emit(.toast(.info, message: "2", undoToken: nil))
        #expect(seen.withLock { $0 } == ["a:1", "b:1", "b:2"])
        #expect(bus.listenerCount == 1)
    }

    @Test func streamDeliversLaterEventsAndUnsubscribesWhenItEnds() async {
        let bus = EventBus()
        let stream = bus.stream()
        #expect(bus.listenerCount == 1)
        bus.emit(.toast(.info, message: "x", undoToken: nil))
        var iterator = stream.makeAsyncIterator()
        let event = await iterator.next()
        #expect(event == .toast(.info, message: "x", undoToken: nil))
        let task = Task { for await _ in bus.stream() {} }
        #expect(await serviceEventually { bus.listenerCount == 2 })
        task.cancel()
        _ = await task.value
        #expect(await serviceEventually { bus.listenerCount == 1 })
    }
}

@Suite("Service observation")
struct ServiceObservationTests {
    private final class Counter: Sendable {
        private let value = Mutex(0)
        func next() -> Int { value.withLock { $0 += 1; return $0 } }
        var count: Int { value.withLock { $0 } }
    }

    private static func changed(_ event: FlintEvent) -> Bool {
        if case .mailChanged = event { return true }
        return false
    }

    @Test func yieldsNowAndAfterEachMatchingEvent() async throws {
        let bus = EventBus()
        let counter = Counter()
        let stream = bus.observe(matching: Self.changed, fetch: { counter.next() })
        var iterator = stream.makeAsyncIterator()
        #expect(try await iterator.next() == 1)
        bus.emit(.toast(.info, message: "ignored", undoToken: nil))
        bus.emit(.mailChanged(accountId: "a", threadIds: []))
        #expect(try await iterator.next() == 2)
        #expect(counter.count == 2)
    }

    @Test func aBurstOfEventsFoldsIntoFewFetches() async throws {
        let bus = EventBus()
        let counter = Counter()
        let stream = bus.observe(matching: Self.changed, fetch: {
            try await Task.sleep(for: .milliseconds(40))
            return counter.next()
        })
        var iterator = stream.makeAsyncIterator()
        _ = try await iterator.next()
        for _ in 0..<50 { bus.emit(.mailChanged(accountId: "a", threadIds: [])) }
        #expect(await serviceEventually { counter.count >= 2 })
        try await Task.sleep(for: .milliseconds(200))
        #expect(counter.count <= 4)
    }

    @Test func firstFetchFailureEndsTheStreamWithThatError() async {
        let bus = EventBus()
        let stream: AsyncThrowingStream<Int, Error> = bus.observe(matching: Self.changed, fetch: { throw FlintError(.notFound, "gone") })
        var iterator = stream.makeAsyncIterator()
        do {
            _ = try await iterator.next()
            Issue.record("expected an error")
        } catch let error as FlintError {
            #expect(error.code == .notFound)
        } catch {
            Issue.record("wrong error \(error)")
        }
    }

    @Test func laterFailuresAreSkippedAndTheNextEventTriesAgain() async throws {
        let bus = EventBus()
        let counter = Counter()
        let stream = bus.observe(matching: Self.changed, fetch: {
            let n = counter.next()
            if n == 2 { throw FlintError(.network, "offline") }
            return n
        })
        var iterator = stream.makeAsyncIterator()
        #expect(try await iterator.next() == 1)
        bus.emit(.mailChanged(accountId: "a", threadIds: []))
        #expect(await serviceEventually { counter.count == 2 })
        try await Task.sleep(for: .milliseconds(50))
        bus.emit(.mailChanged(accountId: "a", threadIds: []))
        #expect(try await iterator.next() == 3)
    }

    @Test func cancellingTheConsumerRemovesTheListener() async {
        let bus = EventBus()
        let task = Task {
            for try await _ in bus.observe(matching: Self.changed, fetch: { 1 }) {}
        }
        #expect(await serviceEventually { bus.listenerCount == 1 })
        task.cancel()
        #expect(await serviceEventually { bus.listenerCount == 0 })
    }
}

@Suite("Service classifier adapter")
struct ServiceClassifierAdapterTests {
    private let adapter = ClassifierAdapter()

    @Test func newsletterHeadersFileUnderNewsletters() {
        let category = adapter.category(
            from: Address(name: "Shop", address: "news@shop.example"), headers: ["list-unsubscribe": "<mailto:u@shop.example>", "list-id": "<offers.shop.example>"],
            isKnownContact: false, subject: "Weekly deals")
        #expect(category == .newsletters)
    }

    @Test func knownContactsAreAlwaysPeople() {
        let category = adapter.category(
            from: Address(address: "news@shop.example"), headers: ["list-unsubscribe": "<mailto:u@shop.example>"], isKnownContact: true, subject: "Hi")
        #expect(category == .people)
    }

    @Test func rulesFireThroughTheRealMatcher() {
        let rule = Rule(
            id: 1, name: "Invoices", conditions: [RuleCondition(field: .subject, op: .contains, value: "invoice")], actions: [.category(.notifications), .pin])
        let hit = adapter.ruleActions(
            rules: [rule], accountId: "a", from: [Address(address: "x@y.example")], to: [], cc: [], bcc: [], subject: "Your invoice", body: "", headers: [:], hasAttachments: false)
        let miss = adapter.ruleActions(
            rules: [rule], accountId: "a", from: [Address(address: "x@y.example")], to: [], cc: [], bcc: [], subject: "Lunch", body: "", headers: [:], hasAttachments: false)
        #expect(hit == [.category(.notifications), .pin])
        #expect(miss.isEmpty)
    }
}

@Suite("Service signatures")
struct ServiceSignatureTests {
    private let sig = Signature(id: 4, name: "Work", html: "<b>Ann</b>")

    @Test func appendsWhenThereIsNoBlock() {
        let html = Signatures.replace("<p>Hi</p>", with: sig)
        #expect(html == "<p>Hi</p><br><div class=\"flint_signature\" data-signature-id=\"4\"><b>Ann</b></div>")
        #expect(Signatures.has(html))
    }

    @Test func swapsTheExistingBlockEvenWithNestedDivs() {
        let old = "<p>Hi</p><br><div class=\"flint_signature\" data-signature-id=\"1\"><div>one</div><div>two</div></div><p>after</p>"
        let swapped = Signatures.replace(old, with: sig)
        #expect(swapped == "<p>Hi</p><br><div class=\"flint_signature\" data-signature-id=\"4\"><b>Ann</b></div><p>after</p>")
    }

    @Test func removingDropsTheBlockAndItsLeadingBreak() {
        let old = "<p>Hi</p><br><div class=\"flint_signature\" data-signature-id=\"1\">x</div>"
        #expect(Signatures.replace(old, with: nil) == "<p>Hi</p>")
        #expect(Signatures.replace("<p>Hi</p>", with: nil) == "<p>Hi</p>")
    }

    @Test func settingsChoiceBeatsTheDefaultFlagAndNullMeansNone() {
        let flagged = Signature(id: 1, name: "Default", html: "d", accountIds: [], defaultNew: true, defaultReply: false)
        let accountOnly = Signature(id: 2, name: "A", html: "a", accountIds: ["acc"], defaultNew: true)
        let all = [flagged, accountOnly, sig]
        var settings = Settings()
        #expect(Signatures.defaultSignature(all: all, settings: settings, accountId: "acc", mode: .new)?.id == 2)
        #expect(Signatures.defaultSignature(all: all, settings: settings, accountId: "other", mode: .new)?.id == 1)
        #expect(Signatures.defaultSignature(all: all, settings: settings, accountId: "acc", mode: .reply) == nil)
        settings.compose.defaultSignatureByAccount["acc"] = .some(4)
        #expect(Signatures.defaultSignature(all: all, settings: settings, accountId: "acc", mode: .new)?.id == 4)
        settings.compose.defaultSignatureByAccount["acc"] = .some(nil)
        #expect(Signatures.defaultSignature(all: all, settings: settings, accountId: "acc", mode: .new) == nil)
        settings.compose.defaultSignatureByAccount["acc"] = .some(99)
        #expect(Signatures.defaultSignature(all: all, settings: settings, accountId: "acc", mode: .new)?.id == 2)
    }

    @Test func repliesReadTheirOwnMapFirst() {
        var settings = Settings()
        settings.compose.defaultSignatureByAccount["acc"] = .some(4)
        settings.compose.defaultReplySignatureByAccount["acc"] = .some(nil)
        #expect(Signatures.defaultSignature(all: [sig], settings: settings, accountId: "acc", mode: .replyAll) == nil)
        #expect(Signatures.defaultSignature(all: [sig], settings: settings, accountId: "acc", mode: .new)?.id == 4)
    }
}

@Suite("Service image policy")
struct ServiceImagePolicyTests {
    private func policy(_ mode: Settings.Inbox.RemoteImages, senders: Set<String> = [], allowed: Set<MessageRowID> = [], sentTo: Set<String> = []) -> ImagePolicy {
        ImagePolicy(mode: mode, senders: senders, messagesAllowed: allowed, sentTo: sentTo)
    }
    private let ann = [Address(address: "Ann@Example.com")]
    private let plain = SenderTrust(isFromMe: false, inSent: false, headers: [:])

    @Test func alwaysAndNeverAreAbsoluteExceptForOnePerMessageAllowance() {
        #expect(policy(.always).allowed(messageId: 1, from: ann, trust: plain))
        #expect(!policy(.never).allowed(messageId: 1, from: ann, trust: plain))
        #expect(policy(.never, allowed: [1]).allowed(messageId: 1, from: ann, trust: plain))
    }

    @Test func knownSendersNeedASenderYouTrust() {
        #expect(!policy(.knownSenders).allowed(messageId: 1, from: ann, trust: plain))
        #expect(policy(.knownSenders, senders: ["ann@example.com"]).allowed(messageId: 1, from: ann, trust: plain))
        #expect(policy(.knownSenders, sentTo: ["ann@example.com"]).allowed(messageId: 1, from: ann, trust: plain))
        #expect(!policy(.knownSenders, senders: ["ann@example.com"]).allowed(messageId: 1, from: [], trust: plain))
    }

    @Test func aFailedAuthenticationBlocksEvenAKnownSender() {
        let failed = SenderTrust(isFromMe: false, inSent: false, headers: ["authentication-results": "mx; dkim=fail; spf=pass"])
        #expect(ImagePolicy.authOutcome(failed.headers) == .fail)
        #expect(!policy(.knownSenders, senders: ["ann@example.com"]).allowed(messageId: 1, from: ann, trust: failed))
    }

    @Test func aServerThatVouchesForNothingIsNotTrusted() {
        let silent = SenderTrust(isFromMe: false, inSent: false, headers: ["authentication-results": "mx; dkim=none"])
        let passed = SenderTrust(isFromMe: false, inSent: false, headers: ["authentication-results": "mx; dkim=pass"])
        #expect(!policy(.knownSenders, senders: ["ann@example.com"]).allowed(messageId: 1, from: ann, trust: silent))
        #expect(policy(.knownSenders, senders: ["ann@example.com"]).allowed(messageId: 1, from: ann, trust: passed))
    }

    @Test func aForgedFromYourOwnAddressNeedsAPassOrTheSentFolder() {
        let me = [Address(address: "me@test.local")]
        let forged = SenderTrust(isFromMe: true, inSent: false, headers: [:])
        let sent = SenderTrust(isFromMe: true, inSent: true, headers: [:])
        let passedMine = SenderTrust(isFromMe: true, inSent: false, headers: ["authentication-results": "mx; spf=pass"])
        #expect(!policy(.knownSenders).allowed(messageId: 1, from: me, trust: forged))
        #expect(policy(.knownSenders).allowed(messageId: 1, from: me, trust: sent))
        #expect(policy(.knownSenders).allowed(messageId: 1, from: me, trust: passedMine))
    }
}

@Suite("Service unsubscribe safety")
struct ServiceUnsubscribeSafetyTests {
    @Test func privateAndSpecialAddressesAreNotPublic() {
        for ip in ["10.0.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.9", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"] {
            #expect(!UnsubscribeSafety.isPublicAddress(ip), "\(ip)")
        }
        for ip in ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "172.32.0.1"] {
            #expect(UnsubscribeSafety.isPublicAddress(ip), "\(ip)")
        }
    }

    @Test func oneClickNeedsHttpsAndAPublicLookingHost() {
        #expect(UnsubscribeSafety.isPublicHTTPS(URL(string: "https://list.example.com/u?x=1")!))
        #expect(!UnsubscribeSafety.isPublicHTTPS(URL(string: "http://list.example.com/u")!))
        #expect(!UnsubscribeSafety.isPublicHTTPS(URL(string: "https://localhost/u")!))
        #expect(!UnsubscribeSafety.isPublicHTTPS(URL(string: "https://printer.local/u")!))
        #expect(!UnsubscribeSafety.isPublicHTTPS(URL(string: "https://192.168.0.5/u")!))
        #expect(!UnsubscribeSafety.isPublicHTTPS(URL(string: "https://[::1]/u")!))
    }

    @Test func mailtoParsesAddressSubjectAndBody() {
        let parsed = ServiceCore.parseMailto("mailto:unsub@list.example?subject=Stop%20this&body=remove%20me")
        #expect(parsed?.to == "unsub@list.example")
        #expect(parsed?.subject == "Stop this")
        #expect(parsed?.body == "remove me")
        let bare = ServiceCore.parseMailto("mailto:u@list.example")
        #expect(bare?.subject == "unsubscribe")
        #expect(ServiceCore.parseMailto("https://x.example") == nil)
        #expect(ServiceCore.parseMailto("mailto:") == nil)
    }

    @Test func publicIPLiteralsResolveWithoutDNS() async {
        #expect(await UnsubscribeSafety.resolvesToPublicOnly("8.8.8.8"))
        #expect(!(await UnsubscribeSafety.resolvesToPublicOnly("127.0.0.1")))
    }
}

@Suite("Service helpers")
struct ServiceHelperTests {
    @Test func receiptsHostIsReadFromAnEndpointWithOrWithoutScheme() {
        #expect(ServiceCore.receiptsHost("https://r.example.com/base") == "r.example.com")
        #expect(ServiceCore.receiptsHost("r.example.com") == "r.example.com")
        #expect(ServiceCore.receiptsHost("  ") == nil)
    }

    @Test func draftFilesPickUniqueNamesAndStayInsideTheirFolder() throws {
        #expect(DraftFiles.uniqueName("a.pdf", taken: ["a.pdf", "a (1).pdf"]) == "a (2).pdf")
        #expect(DraftFiles.uniqueName("notes", taken: ["notes"]) == "notes (1)")
        #expect(DraftFiles.contentType(for: "x.PNG") == "image/png")
        #expect(DraftFiles.contentType(for: "x.unknown") == "application/octet-stream")

        let root = FileManager.default.temporaryDirectory.appendingPathComponent("flint-df-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let dir = DraftFiles.directory(root, draftId: 3)
        let saved = try DraftFiles.write(Data("hi".utf8), filename: "../evil/a.txt", contentType: "", to: dir, existing: [])
        #expect(saved.path.hasPrefix(dir.path))
        #expect(saved.contentType == "text/plain")
        let outside = root.appendingPathComponent("keep.txt")
        try Data("x".utf8).write(to: outside)
        DraftFiles.remove(outside.path, inside: dir)
        #expect(FileManager.default.fileExists(atPath: outside.path))
        DraftFiles.remove(saved.path, inside: dir)
        #expect(!FileManager.default.fileExists(atPath: saved.path))
    }

    @Test func copyInRefusesFoldersAndMissingFiles() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("flint-df-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        #expect(throws: FlintError.self) { try DraftFiles.copyIn(root, to: root.appendingPathComponent("d"), existing: []) }
        #expect(throws: FlintError.self) { try DraftFiles.copyIn(root.appendingPathComponent("nope"), to: root.appendingPathComponent("d"), existing: []) }
    }

    @Test func raceReportsWhetherWorkFinishedInTime() async {
        #expect(await Race.finishes(within: .seconds(2)) {})
        let slow = await Race.finishes(within: .milliseconds(30)) { try? await Task.sleep(for: .milliseconds(300)) }
        #expect(!slow)
    }

    @Test func schedulerPumpRunsTicksAndWakesOnPoke() async {
        let ticks = Mutex(0)
        let pump = SchedulerPump(now: { 0 })
        await pump.bind {
            ticks.withLock { $0 += 1 }
            return nil
        }
        await pump.start()
        #expect(await serviceEventually { ticks.withLock { $0 } == 1 })
        pump.poke()
        #expect(await serviceEventually { ticks.withLock { $0 } == 2 })
        await pump.stop()
        let after = ticks.withLock { $0 }
        pump.poke()
        try? await Task.sleep(for: .milliseconds(100))
        #expect(ticks.withLock { $0 } == after)
    }

    @Test func remoteSearchRequestCarriesCriteriaRolesAndAccounts() {
        let request = RemoteSearch.request(for: "from:ann in:sent -is:read invoice account:Me@Test.local")
        #expect(request.from == "ann")
        #expect(request.text == "invoice")
        #expect(request.seen == false)
        #expect(request.roles == ["sent"])
        #expect(request.accounts == ["me@test.local"])
        #expect(!request.isEmpty)
        #expect(RemoteSearch.request(for: "in:inbox").isEmpty)
    }
}

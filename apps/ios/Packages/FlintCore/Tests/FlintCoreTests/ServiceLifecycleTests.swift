import FlintMail
import FlintModel
import FlintReceipts
import FlintStore
import Foundation
import Testing
@testable import FlintService

private func inbox() -> ThreadQuery { ThreadQuery(view: .inbox) }

@Suite("Service: sync lifecycle")
struct ServiceSyncLifecycleTests {
    @Test func startingSyncsInTheBackgroundAndNewMailIsAnnounced() async throws {
        let rig = try await ServiceRig.make(autoSync: true)
        defer { Task { await rig.cleanup() } }
        await rig.deliver("already here", ageDays: 1)
        try await rig.addAccount()
        await rig.service.start()
        #expect(await serviceEventually { (try? await rig.service.listThreads(inbox()).items.count) == 1 })
        #expect(rig.log.newMailSubjects.isEmpty)

        await rig.deliver("fresh mail", from: "bo@example.org")
        #expect(await serviceEventually { rig.log.newMailSubjects == ["fresh mail"] })
        let statuses = try await rig.service.syncStatuses()
        #expect(statuses.count == 1)
        #expect(statuses.first?.lastSyncAt != nil)

        await rig.service.stop()
        let calls = await rig.fake.connectCount
        await rig.deliver("while stopped")
        try await Task.sleep(for: .milliseconds(300))
        #expect(await rig.fake.connectCount == calls)
    }

    @Test func aRejectedSignInEndsInSignInAgainAndAFixedClientRestartsIt() async throws {
        let rig = try await ServiceRig.make(autoSync: true)
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.service.start()
        #expect(await serviceEventually { (try? await rig.service.syncStatuses().first?.lastSyncAt) != nil })

        await rig.fake.rejectLogins()
        await rig.fake.dropConnection()
        let stopped = await serviceAwait(rig.service.syncStatus()) { $0.first?.state == .authError }
        #expect(stopped?.first?.error == "Sign in again.")
        #expect(rig.log.count { if case .sync(let s) = $0 { return s.state == .authError } else { return false } } >= 1)

        await rig.fake.rejectLogins(false)
        try await rig.service.updateSettings(patch: .object(["google": .object(["clientId": .string("other.apps.googleusercontent.com")])]))
        let recovered = await serviceAwait(rig.service.syncStatus(), timeout: .seconds(8)) { $0.first?.state == .idle && $0.first?.error == nil }
        #expect(recovered != nil)
    }

    @Test func removingAnAccountStopsItsSyncAndForgetsEverything() async throws {
        let rig = try await ServiceRig.make(autoSync: true)
        defer { Task { await rig.cleanup() } }
        let account = try await rig.addAccount()
        await rig.deliver("hello", ageDays: 1)
        await rig.service.start()
        #expect(await serviceEventually { (try? await rig.service.listThreads(inbox()).items.count) == 1 })
        let cache = rig.directory.appendingPathComponent("cache/attachments/\(account.id)")
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        try Data("x".utf8).write(to: cache.appendingPathComponent("a.bin"))

        try await rig.service.removeAccount(id: account.id)
        #expect(try await rig.service.listAccounts().isEmpty)
        #expect(!rig.service.core.sync.isRunning(account.id))
        #expect(!FileManager.default.fileExists(atPath: cache.path))
        #expect(try await rig.secrets.get(secretKey(for: account.id)) == nil)
        #expect(try await rig.service.syncStatuses().isEmpty)
        await #expect(throws: FlintError.self) { try await rig.service.removeAccount(id: account.id) }
    }

    @Test func syncNowReportsAnUnknownAccountAndSurfacesASingleAccountFailure() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let account = try await rig.addAccount()
        await #expect(throws: FlintError.self) { try await rig.service.syncNow(accountId: "nope") }
        await rig.fake.rejectLogins()
        await #expect(throws: FlintError.self) { try await rig.service.syncNow(accountId: account.id) }
    }

    @Test func accountsAndFoldersAreObservable() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let watch = Task { await serviceAwait(rig.service.accounts()) { $0.count == 1 } }
        try await Task.sleep(for: .milliseconds(100))
        let account = try await rig.addAccount()
        #expect(await watch.value?.first?.id == account.id)
        try await rig.service.syncNow()
        let folders = await serviceAwait(rig.service.folders(accountId: account.id)) { $0.contains { $0.role == .inbox } }
        #expect(folders?.contains { $0.role == .sent } == true)
        #expect(try await rig.service.folders(accountId: account.id).count >= 5)
        await #expect(throws: FlintError.self) { _ = try await rig.service.folders(accountId: "nope") }
    }
}

@Suite("Service: start-up work")
struct ServiceStartupTests {
    @Test func categorizerMaintenanceRunsOncePerVersion() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.deliver("Weekly deals", from: "news@shop.example", ageDays: 1, headers: ["list-unsubscribe": "<mailto:u@shop.example>", "list-id": "<x>"])
        try await rig.service.syncNow()
        // Pretend the mail was labelled by an older categorizer.
        try await StoreTestKit.exec(rig.store, "UPDATE messages SET category = 'people'")
        try await StoreTestKit.exec(rig.store, "UPDATE threads SET category = 'people'")
        try await rig.store.kvSet("categorizerVersion", "1", ttlMs: nil, now: rig.clock.now)

        await rig.service.start()
        await rig.service.waitForMaintenance()
        #expect(try await rig.store.kvGet("categorizerVersion", now: rig.clock.now) == "2")
        #expect(try await rig.service.listThreads(inbox()).items.first?.category == .newsletters)
        #expect(rig.log.count { if case .mailChanged(_, let ids) = $0 { return ids.isEmpty } else { return false } } >= 1)

        let again = await rig.service.core.recategorizeIfStale()
        #expect(again == 0)
    }

    @Test func startTwiceWiresTheListenersOnce() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let before = rig.service.core.bus.listenerCount
        await rig.service.start()
        let once = rig.service.core.bus.listenerCount
        await rig.service.start()
        #expect(rig.service.core.bus.listenerCount == once)
        #expect(once == before + 2)
        await rig.service.stop()
        #expect(rig.service.core.bus.listenerCount == before)
    }

    @Test func settingsChangesAreStoredAnnouncedAndStreamed() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let watch = Task { await serviceAwait(rig.service.settings()) { $0.appearance.theme == .dark } }
        try await Task.sleep(for: .milliseconds(100))
        let updated = try await rig.service.updateSettings(patch: .object(["appearance": .object(["theme": .string("dark")])]))
        #expect(updated.appearance.theme == .dark)
        #expect(updated.inbox.focused)
        #expect(await watch.value?.appearance.theme == .dark)
        #expect(rig.log.count { if case .settings(let s) = $0 { return s.appearance.theme == .dark } else { return false } } == 1)

        var whole = try await rig.service.currentSettings()
        whole.compose.undoSendSeconds = 20
        whole.notifications.scope = .all
        let stored = try await rig.service.updateSettings(whole)
        #expect(stored.compose.undoSendSeconds == 20)
        #expect(stored.appearance.theme == .dark)
        await #expect(throws: FlintError.self) { _ = try await rig.service.updateSettings(patch: .object(["nonsense": .bool(true)])) }
    }

    @Test func theDatabaseIsOpenedOnDiskPrivateAndKeepsItsDataAcrossRestarts() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("flint-open-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let fake = FakeMailTransport(capabilities: TransportCapabilities(), folders: ServiceRig.folders)
        let configuration = FlintServiceConfiguration(
            dataDirectory: directory.appendingPathComponent("data"), cacheDirectory: directory.appendingPathComponent("cache"),
            secrets: InMemorySecretStore(), browser: ServiceBrowserStub(), transport: { fake }, http: ServiceHTTPStub.client,
            autoconfig: ServiceHTTPStub.autoconfig, network: nil, runsScheduler: false, autoSync: false)
        do {
            let service = try await FlintService.open(configuration: configuration)
            _ = try await service.saveTemplate(Template(id: 0, name: "Keep", html: "<p>x</p>"))
            await service.stop()
        }
        let reopened = try await FlintService.open(configuration: configuration)
        #expect(try await reopened.listTemplates().map(\.name) == ["Keep"])
        let attributes = try FileManager.default.attributesOfItem(atPath: configuration.databasePath)
        #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
        await reopened.stop()
    }

    @Test func theClassifierIsWiredIntoTheOpenedStore() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        _ = try await rig.service.saveRule(Rule(
            id: 0, name: "Pin invoices", conditions: [RuleCondition(field: .subject, op: .contains, value: "invoice")], actions: [.pin, .category(.notifications)]))
        await rig.deliver("Quiet day", ageDays: 1)
        try await rig.service.syncNow()
        await rig.deliver("Your invoice", from: "billing@acme.example", ageDays: 0)
        try await rig.service.syncNow()
        let page = try await rig.service.listThreads(inbox())
        let invoice = try #require(page.items.first { $0.subject == "Your invoice" })
        #expect(invoice.category == .notifications)
    }
}

@Suite("Service: codes and receipts")
struct ServiceSignalTests {
    @Test func aFreshCodeIsAnnouncedListedBadgedAndCanBeMarkedUsed() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.service.start()
        await rig.service.waitForMaintenance()
        await rig.deliver("Quiet day", ageDays: 1)
        try await rig.service.syncNow()

        await rig.deliver("Your Acme verification code is 482913", from: "no-reply@acme.example", body: "Your Acme verification code is 482913. It expires in 10 minutes.")
        try await rig.service.syncNow()
        #expect(await serviceEventually { rig.log.codes.count == 1 })
        let code = try #require(rig.log.codes.first)
        #expect(code.code == "482913")
        #expect(code.senderAddress == "no-reply@acme.example")
        #expect(code.expiresAt == rig.clock.now + VerificationCode.ttlMs)

        let recent = await rig.service.recentCodes()
        #expect(recent.map(\.code) == ["482913"])
        let page = try await rig.service.listThreads(inbox())
        #expect(page.items.first { $0.id == code.threadId }?.verificationCode?.code == "482913")
        let view = try #require(try await rig.service.thread(id: code.threadId).messages.first)
        #expect(view.verificationCode?.id == code.id)

        await rig.service.markCodeUsed(id: code.id)
        #expect(await rig.service.recentCodes().first?.used == true)
        await rig.service.markCodeUsed(id: "unknown")

        rig.clock.advance(VerificationCode.ttlMs + 1000)
        #expect(await rig.service.recentCodes().isEmpty)
    }

    @Test func codesAreNotLookedForWhenTheSettingIsOffAndSurviveARestart() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        try await rig.addAccount()
        await rig.service.start()
        await rig.service.waitForMaintenance()
        await rig.deliver("Quiet day", ageDays: 1)
        try await rig.service.syncNow()
        try await rig.service.updateSettings(patch: .object(["codes": .object(["enabled": .bool(false)])]))
        await rig.deliver("Code 111222", from: "no-reply@acme.example", body: "Your Acme verification code is 111222")
        try await rig.service.syncNow()
        try await Task.sleep(for: .milliseconds(150))
        #expect(rig.log.codes.isEmpty)

        try await rig.service.updateSettings(patch: .object(["codes": .object(["enabled": .bool(true)])]))
        await rig.deliver("Code 333444", from: "no-reply@acme.example", body: "Your Acme verification code is 333444")
        try await rig.service.syncNow()
        #expect(await serviceEventually { rig.log.codes.count == 1 })
        // A second registry over the same database (a cold start) still has it.
        let cold = CodesRegistry(store: rig.store, now: { rig.clock.now })
        #expect(await cold.list().map(\.code) == ["333444"])
    }

    @Test func aReplyFromATrackedRecipientIsAnnouncedOnce() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        let account = try await rig.addAccount()
        await rig.service.start()
        await rig.service.waitForMaintenance()
        await rig.deliver("Proposal", from: "me@test.local", ageDays: 1, messageId: "<sent1@test.local>", to: "Sent")
        try await rig.service.syncNow()
        let sent = try #require(try await rig.store.messages(accountId: account.id, messageId: "<sent1@test.local>").first)
        _ = try await rig.store.createTracked(NewTracked(
            accountId: account.id, ref: "REF1", messageId: "sent1@test.local", threadId: sent.threadId, subject: "Proposal", sentAt: sent.date,
            recipients: [.init(email: "ann@example.com", name: "Ann", token: ReceiptPixel.newToken())]))

        await rig.deliver("Re: Proposal", from: "ann@example.com", messageId: "<re1@example.com>", inReplyTo: "<sent1@test.local>")
        try await rig.service.syncNow()
        #expect(await serviceEventually { rig.log.receipts == [.replied] })
        await rig.deliver("Re: Re: Proposal", from: "ann@example.com", messageId: "<re2@example.com>", inReplyTo: "<re1@example.com>")
        try await rig.service.syncNow()
        try await Task.sleep(for: .milliseconds(150))
        #expect(rig.log.receipts == [.replied])
    }

    @Test func aTrackedSendRegistersEachRecipientAndAnOpenArrivesAsAnEvent() async throws {
        let service = FakeReceiptsService()
        let rig = try await ServiceRig.make(receiptsTransport: service)
        defer { Task { await rig.cleanup() } }
        let account = try await rig.addAccount()
        try await rig.service.updateSettings(patch: .object([
            "receipts": .object(["endpoint": .string("https://receipts.example.com"), "enabled": .bool(true)]),
            "compose": .object(["undoSendSeconds": .number(0)]),
        ]))
        let draft = try await rig.service.createDraft(.new(
            accountId: account.id, to: [Address(address: "bo@example.org"), Address(address: "cy@example.org")], subject: "Pitch", html: "<p>Hello</p>"))
        #expect(draft.track)
        #expect(draft.trackingBlockedReason == nil)
        _ = try await rig.service.sendDraft(id: draft.id)
        _ = await rig.service.runDueWork()

        let sent = await rig.fake.sentMessages
        #expect(sent.count == 2)
        #expect(Set(sent.flatMap(\.recipients)) == ["bo@example.org", "cy@example.org"])
        for message in sent { #expect(String(decoding: message.raw, as: UTF8.self).contains("https://receipts.example.com/")) }

        let tracked = try #require(try await rig.service.listTracked().first)
        #expect(tracked.subject == "Pitch")
        #expect(tracked.recipients.count == 2)
        let ref = try #require(service.messageRefs.first)
        service.addEvent(token: try #require(service.tokens(for: ref).first))
        try await rig.service.refreshReceipts()
        #expect(rig.log.receipts.contains(.opened))
        let after = try #require(try await rig.service.listTracked().first)
        #expect(after.summary.opened == 1)
        #expect(try await rig.service.receipt(trackedId: after.trackedId).events.count == 1)

        try await rig.service.stopTracking(trackedId: after.trackedId)
        #expect(service.messageRefs.isEmpty)
    }

    @Test func refreshingReceiptsWithoutAnAddressSaysWhatToDo() async throws {
        let rig = try await ServiceRig.make()
        defer { Task { await rig.cleanup() } }
        do {
            try await rig.service.refreshReceipts()
            Issue.record("expected an error")
        } catch let error as FlintError {
            #expect(error.code == .invalid)
            #expect(error.message.contains("Settings"))
        }
    }
}

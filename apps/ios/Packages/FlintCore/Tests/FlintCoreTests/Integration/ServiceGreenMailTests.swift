import FlintMail
import FlintModel
import FlintStore
import Foundation
import Testing
@testable import FlintService

/// The whole service against a real IMAP/SMTP server (GreenMail) through `SwiftMailTransport`: `FLINT_GREENMAIL=1 swift test --filter ServiceGreenMail`.
@Suite("Service on GreenMail", .enabled(if: mailGreenMailEnabled), .serialized)
struct ServiceGreenMailTests {
    private func rig() async throws -> (service: FlintService, server: MailGreenMailServer, user: String, directory: URL) {
        let (server, user) = try await MailSharedGreenMail.shared.freshUser()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("flint-svc-gm-\(UUID().uuidString)")
        let store = try GRDBStore.inMemory(classifier: ClassifierAdapter())
        let configuration = FlintServiceConfiguration(
            dataDirectory: directory.appendingPathComponent("data"), cacheDirectory: directory.appendingPathComponent("cache"), secrets: InMemorySecretStore(),
            browser: ServiceBrowserStub(), http: ServiceHTTPStub.client, autoconfig: ServiceHTTPStub.autoconfig, network: nil,
            session: SessionConfigurationOverrides(pollInterval: .seconds(1), idlePollInterval: .seconds(10)), runsScheduler: false, autoSync: false)
        return (FlintService(store: store, configuration: configuration), server, user, directory)
    }

    @Test func addSyncReadArchiveSendToSelfAndFindTheSentCopy() async throws {
        let (service, server, user, directory) = try await rig()
        defer { try? FileManager.default.removeItem(at: directory) }
        let check = try await service.testConnection(AddAccountInput(email: server.email(user), name: "Me", password: MailGreenMailServer.password, provider: .imap, server: server.server(for: user)))
        #expect(check.isOK)
        let account = try await service.addAccount(AddAccountInput(email: server.email(user), name: "Me", password: MailGreenMailServer.password, provider: .imap, server: server.server(for: user)))

        _ = try await server.deliver(to: user, subject: "Hello from outside", text: "Greetings")
        try await service.syncNow()
        let inbox = ThreadQuery(view: .inbox)
        let thread = try #require(try await service.listThreads(inbox).items.first)
        #expect(thread.subject == "Hello from outside")
        let detail = try await service.thread(id: thread.id)
        #expect(detail.messages.first?.bodyLoaded == true)

        _ = try await service.markRead([thread.id], read: true)
        let token = try await service.archive([thread.id])
        #expect(try await service.listThreads(inbox).items.isEmpty)
        try await service.undo(token)
        #expect(try await service.listThreads(inbox).items.count == 1)

        try await service.updateSettings(patch: .object(["compose": .object(["undoSendSeconds": .number(0)])]))
        let draft = try await service.createDraft(.new(accountId: account.id, to: [Address(address: server.email(user))], subject: "Note to self", html: "<p>remember</p>"))
        _ = try await service.updateDraft(id: draft.id, DraftPatch(track: false))
        _ = try await service.sendDraft(id: draft.id)
        _ = await service.runDueWork()
        #expect(try await service.listDrafts().isEmpty)

        var arrived = false
        for _ in 0..<20 where !arrived {
            try await service.syncNow()
            arrived = try await service.listThreads(ThreadQuery(view: .search, search: "Note to self")).items.count >= 1
            if !arrived { try await Task.sleep(for: .milliseconds(300)) }
        }
        #expect(arrived)
        #expect(try await service.listThreads(ThreadQuery(view: .sent)).items.contains { $0.subject == "Note to self" })
        await service.stop()
    }
}

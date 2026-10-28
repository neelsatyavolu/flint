import FlintModel
import FlintService
import Foundation
import UIKit

/// The service and what only a demo launch adds to it.
struct OpenedService: Sendable {
    let service: FlintService
    let demoDirectory: URL?
    let demoDeliverNewMail: (@Sendable () async -> Void)?
}

/// The first inbox page, read while the rest of the launch state loads, with the query it answers.
struct FirstPagePrefetch: Sendable {
    let query: ThreadQuery
    let page: ThreadPage
}

extension AppModel {
    /// Opens the service off the main actor and, in the same breath, reads the first inbox page. The main actor is busy building the
    /// scene for the first 100 ms or so, so anything that waits for it for these two reads is late; started here they overlap with it.
    /// Safe to call more than once. The second call returns the first call's task.
    @discardableResult
    func beginOpening() -> Task<OpenedService, Error> {
        if let opening { return opening }
        let mode = self.mode
        let task = Task.detached(priority: .userInitiated) { try await Self.open(mode: mode) }
        opening = task
        if !mode.isInjected { startFirstPagePrefetch(after: task) }
        return task
    }

    nonisolated private static func open(mode: LaunchMode) async throws -> OpenedService {
        switch mode {
        case .injected(let service):
            return OpenedService(service: service, demoDirectory: nil, demoDeliverNewMail: nil)
        case .demo:
            let seeded = try await DemoSeed.make()
            return OpenedService(service: seeded.service, demoDirectory: seeded.directory, demoDeliverNewMail: seeded.deliverNewMail)
        case .live:
            let service = try await FlintService.open(configuration: LiveConfiguration.make())
            return OpenedService(service: service, demoDirectory: nil, demoDeliverNewMail: nil)
        }
    }

    private func startFirstPagePrefetch(after opening: Task<OpenedService, Error>) {
        let limit = InboxViewModel.pageSize
        let mailbox = self.mailbox
        prefetch = Task.detached(priority: .userInitiated) {
            guard let service = try? await opening.value.service, let settings = try? await service.currentSettings(),
                  let query = mailbox.threadQuery(focused: settings.inbox.focused, limit: limit),
                  let page = try? await service.listThreads(query) else { return nil }
            return FirstPagePrefetch(query: query, page: page)
        }
    }

    /// The prefetched page when it was read for exactly `query`; nil otherwise. It is handed out once. The list's live query starts
    /// right after and replaces it, so a page that went stale in between is corrected, not kept.
    func takePrefetchedPage(for query: ThreadQuery) async -> ThreadPage? {
        guard let pending = prefetch else { return nil }
        prefetch = nil
        guard let result = await pending.value, result.query == query else { return nil }
        return result.page
    }

    /// Starts opening the service as the app object is built, so it overlaps with the scene and the first render instead of waiting
    /// for `RootView`'s task. Skipped for a background launch (a refresh or a notification button opens the service itself, without
    /// sync sessions), for unit tests and for the theme gallery. `bootstrap()` shares the opening task.
    func bootstrapAtLaunch() {
        guard !FlintDebugFlags.isHostingUnitTests, !FlintDebugFlags.themeGallery(), UIApplication.shared.applicationState != .background else { return }
        PerfProbe.mark("earlyOpen")
        beginOpening()
    }
}

extension AppModel {
    /// Loads the web framework a couple of seconds after the first screen, off the main thread, so the first link a person taps does
    /// not wait for it. Not in unit tests.
    func prewarmLazyFrameworks() {
        guard !FlintDebugFlags.isHostingUnitTests else { return }
        Task.detached(priority: .utility) {
            try? await Task.sleep(for: .seconds(2))
            LazyWeb.prewarm()
        }
    }
}

@testable import Flint
import FlintModel
import FlintService
import Foundation

/// A booted `AppModel` over the demo mailbox, for tests of any feature: `let app = try await SeededApp.make()`. The mailbox is
/// built through the real sync path from in-memory servers, so it takes a few seconds. Call `await app.tearDown()` at the end.
@MainActor
struct SeededApp {
    let model: AppModel
    let seed: DemoSeedResult

    static func make() async throws -> SeededApp {
        let seed = try await DemoSeed.make()
        let model = AppModel(mode: .injected(seed.service), toasts: ToastCenter(duration: .milliseconds(200)), defaults: ephemeralDefaults())
        await model.bootstrap()
        return SeededApp(model: model, seed: seed)
    }

    func tearDown() async {
        await model.shutdown()
    }

    /// Every conversation in the unified inbox with bundles unfolded.
    func inboxThreads() async throws -> [ThreadListItem] {
        try await model.listThreads(ThreadQuery(view: .inbox, focused: false, limit: 200)).items
    }

    func thread(subject: String) async throws -> ThreadListItem? {
        try await inboxThreads().first { $0.subject == subject }
    }

    private static func ephemeralDefaults() -> UserDefaults {
        let name = "flint.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name) ?? .standard
        defaults.removePersistentDomain(forName: name)
        return defaults
    }
}

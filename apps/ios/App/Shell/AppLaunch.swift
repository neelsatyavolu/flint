import FlintMail
import FlintModel
import FlintService
import Foundation

/// How the app gets its service.
enum LaunchMode: Sendable {
    /// The real database under Application Support, the Keychain and live servers.
    case live
    /// A fresh temporary database filled from a fictional mailbox (`-FlintSeed demo`). Nothing leaves the device.
    case demo
    /// A service the caller built (tests and previews).
    case injected(FlintService)

    static func fromArguments(_ defaults: UserDefaults = .standard) -> LaunchMode {
        DemoSeed.isRequested(defaults: defaults) ? .demo : .live
    }

    var isDemo: Bool {
        if case .demo = self { return true }
        return false
    }
}

enum LiveConfiguration {
    /// Application Support/Flint for the database and drafts, Caches/Flint for attachments.
    static func make() throws -> FlintServiceConfiguration {
        let files = FileManager.default
        let support = try files.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let caches = try files.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return FlintServiceConfiguration(
            dataDirectory: support.appendingPathComponent("Flint", isDirectory: true),
            cacheDirectory: caches.appendingPathComponent("Flint", isDirectory: true),
            secrets: KeychainSecretStore(), browser: SystemOAuthBrowser())
    }
}

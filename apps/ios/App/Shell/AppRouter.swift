import Observation
import SwiftUI

/// Holds the last link the app was opened with until the owning feature consumes it. The Google sign-in session
/// normally receives its own callback; this is the fallback for a cold launch from a URL.
@MainActor @Observable
final class AppRouter {
    private(set) var pending: DeepLink?

    func handle(_ url: URL) {
        let link = DeepLink.parse(url)
        if link != .unknown { pending = link }
    }

    /// Returns and clears the pending link.
    func take() -> DeepLink? {
        defer { pending = nil }
        return pending
    }
}

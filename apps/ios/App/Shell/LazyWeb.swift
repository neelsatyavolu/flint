import FlintModel
import Foundation
import UIKit

/// Safari's in-app view, Quick Look and the Google sign-in session, from the embedded `FlintLazyWeb.framework` (LazyWeb/LazyWeb.swift). That
/// framework is not linked into the app: SafariServices and QuickLook cost about 150 ms of every launch, so they are
/// loaded the first time they are needed, or by `prewarm()` shortly after the first screen is up.
@MainActor
enum LazyWeb {
    nonisolated private static let className = "FlintLazyWeb"
    nonisolated private static let frameworkName = "FlintLazyWeb.framework"

    /// Loads the framework on a background thread so the first link or sign-in does not wait for it.
    nonisolated static func prewarm() {
        Task.detached(priority: .utility) { _ = loadedClass() }
    }

    nonisolated private static func loadedClass() -> AnyObject? {
        if let loaded = NSClassFromString(className) { return loaded }
        guard let directory = Bundle.main.privateFrameworksPath, Bundle(path: directory + "/" + frameworkName)?.load() == true else { return nil }
        return NSClassFromString(className)
    }

    /// The Safari view controller for `url`; nil only if the framework cannot be loaded.
    static func safariController(for url: URL) -> UIViewController? {
        let result = loadedClass()?.perform(NSSelectorFromString("safariControllerForURL:"), with: url as NSURL)
        return result?.takeUnretainedValue() as? UIViewController
    }

    /// Quick Look for a file on disk, presented over the current screen.
    static func preview(_ url: URL) {
        _ = loadedClass()?.perform(NSSelectorFromString("presentPreviewForURL:"), with: url as NSURL)
    }

    /// Runs the sign-in page and returns the callback URL. Throws `googleSignInCancelled` when the sheet is closed.
    static func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        guard let bridge = loadedClass() else { throw FlintError(.auth, "Google sign-in failed.") }
        return try await withCheckedThrowingContinuation { continuation in
            let completion: @convention(block) (NSURL?, Int) -> Void = { callback, code in
                if let callback {
                    continuation.resume(returning: callback as URL)
                } else if code == 1 {
                    continuation.resume(throwing: FlintError.googleSignInCancelled)
                } else {
                    continuation.resume(throwing: FlintError(.auth, "Google sign-in failed."))
                }
            }
            let request: NSDictionary = ["url": url as NSURL, "scheme": callbackScheme as NSString]
            _ = bridge.perform(NSSelectorFromString("authenticate:completion:"), with: request, with: unsafeBitCast(completion, to: AnyObject.self))
        }
    }
}

import FlintMail
import FlintModel
import UIKit

/// Runs the Google sign-in page in `ASWebAuthenticationSession` (never a web view: Google refuses those), through the lazily
/// loaded `FlintLazyWeb.framework` (see `LazyWeb`).
struct SystemOAuthBrowser: OAuthBrowser {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        try await LazyWeb.authenticate(url: url, callbackScheme: callbackScheme)
    }
}

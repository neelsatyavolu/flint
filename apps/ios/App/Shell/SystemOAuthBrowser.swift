import AuthenticationServices
import FlintMail
import FlintModel
import UIKit

/// Runs the Google sign-in page in `ASWebAuthenticationSession` (never a web view: Google refuses those). The session is
/// not ephemeral, so Google remembers the person between sign-ins.
struct SystemOAuthBrowser: OAuthBrowser {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        try await OAuthSessionRunner().run(url: url, callbackScheme: callbackScheme)
    }
}

@MainActor
private final class OAuthSessionRunner: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func run(url: URL, callbackScheme: String) async throws -> URL {
        defer { session = nil }
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callback: .customScheme(callbackScheme)) { callback, error in
                if let callback {
                    continuation.resume(returning: callback)
                } else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                    continuation.resume(throwing: FlintError.googleSignInCancelled)
                } else {
                    continuation.resume(throwing: FlintError(.auth, "Google sign-in failed."))
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() { continuation.resume(throwing: FlintError(.auth, "Google sign-in failed.")) }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard let scene else { return UIWindow(frame: .zero) }
        return scene.keyWindow ?? ASPresentationAnchor(windowScene: scene)
    }
}

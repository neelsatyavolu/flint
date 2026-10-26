import FlintMail
import FlintModel
import Foundation

/// Turns an error into the short sentence a person sees. The service writes plain messages for rejected input, missing
/// things and sign-in problems, so those pass through; connection and internal failures get fixed text so no host name,
/// command or library message reaches the screen.
enum FlintErrorText {
    private static let maxLength = 160

    static func message(for error: any Error) -> String {
        guard let flint = error as? FlintError else { return fallback(.internal) }
        switch flint.code {
        case .network, .internal, .aiNotConnected:
            return fallback(flint.code)
        case .notFound, .invalid, .auth, .permission, .conflict:
            let text = flint.message.trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? fallback(flint.code) : clipped(text)
        }
    }

    /// Cancelling the Google sheet is not a failure: nothing should be shown for it.
    static func isSilent(_ error: any Error) -> Bool {
        (error as? FlintError)?.isGoogleSignInCancelled ?? false || error is CancellationError
    }

    static func fallback(_ code: FlintErrorCode) -> String {
        switch code {
        case .network: String(localized: "Couldn't connect. Check your connection and try again.", table: "Shared")
        case .notFound: String(localized: "That item no longer exists.", table: "Shared")
        case .invalid: String(localized: "That didn't work. Check what you entered.", table: "Shared")
        case .auth: String(localized: "Sign in again to continue.", table: "Shared")
        case .permission: String(localized: "Flint doesn't have permission to do that.", table: "Shared")
        case .conflict: String(localized: "That conflicts with something that already exists.", table: "Shared")
        case .aiNotConnected: String(localized: "That feature isn't available.", table: "Shared")
        case .internal: String(localized: "Something went wrong. Try again.", table: "Shared")
        }
    }

    private static func clipped(_ text: String) -> String {
        text.count <= maxLength ? text : String(text.prefix(maxLength - 1)) + "…"
    }
}

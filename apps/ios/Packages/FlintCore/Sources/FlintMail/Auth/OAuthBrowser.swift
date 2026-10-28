// The seams between the account service and the app (track 2C).

import FlintModel
import Foundation

/// Opens the sign-in page and returns the redirect URL. The app implements it with `ASWebAuthenticationSession`
/// (callback `.customScheme(callbackScheme)`, ephemeral session off so Google remembers the user). Throw
/// `FlintError.googleSignInCancelled` when the user closes the sheet. Never use a WKWebView: Google refuses it.
public protocol OAuthBrowser: Sendable {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL
}

/// What the account service tells the rest of the engine. 2F wires these to the sync manager and the event bus.
public protocol AccountLifecycle: Sendable {
    /// Start or restart syncing this account (new credentials, enabled again).
    func restartSync(_ id: AccountID) async
    /// Stop syncing and drop any connection and cached credential for this account.
    func forgetSync(_ id: AccountID) async
    /// Something about the account changed: emit `mail_changed` and refresh account lists.
    func accountChanged(_ id: AccountID) async
}

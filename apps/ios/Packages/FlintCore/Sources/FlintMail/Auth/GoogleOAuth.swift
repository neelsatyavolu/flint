// Google sign-in for iOS (track 2C). Port of packages/core/src/mail/google-oauth.ts for a public client:
// PKCE (S256), no client secret, redirect `com.googleusercontent.apps.<id>:/oauth2redirect`. The browser step is
// behind `OAuthBrowser` (the app implements it with ASWebAuthenticationSession), so everything here is testable.
// Tokens and codes are never logged and never put in error messages.

import CryptoKit
import FlintModel
import Foundation

public struct GoogleOAuthConfig: Hashable, Sendable {
    public static let authURL = URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    public static let tokenURL = URL(string: "https://oauth2.googleapis.com/token")!
    public static let scopes = "https://mail.google.com/ openid email profile"
    /// Refresh this long before the access token expires.
    public static let refreshMargin: TimeInterval = 5 * 60

    public var clientId: String

    public init(clientId: String) { self.clientId = clientId }

    /// `123-abc.apps.googleusercontent.com` becomes `com.googleusercontent.apps.123-abc`.
    public var redirectScheme: String {
        let suffix = ".apps.googleusercontent.com"
        let prefix = clientId.hasSuffix(suffix) ? String(clientId.dropLast(suffix.count)) : clientId
        return "com.googleusercontent.apps." + prefix
    }

    public var redirectURI: String { redirectScheme + ":/oauth2redirect" }

    /// True when the token expires within the refresh margin (or already has).
    public static func needsRefresh(expiresAt: EpochMs, nowMs: EpochMs) -> Bool {
        expiresAt - nowMs <= Int(refreshMargin * 1000)
    }
}

public struct PKCE: Hashable, Sendable {
    public let verifier: String
    public let challenge: String

    public init(verifier: String) {
        self.verifier = verifier
        challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLString
    }

    public static func make(randomBytes: @Sendable (Int) -> [UInt8] = GoogleOAuthClient.systemRandomBytes) -> PKCE {
        PKCE(verifier: Data(randomBytes(32)).base64URLString)
    }
}

extension Data {
    var base64URLString: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    init?(base64URLString s: String) {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        self.init(base64Encoded: b)
    }
}

extension FlintError {
    static let googleCancelledMessage = "Google sign-in was cancelled."

    /// The user backed out of the Google sign-in sheet. Show nothing.
    public static var googleSignInCancelled: FlintError { FlintError(.auth, googleCancelledMessage) }
    public var isGoogleSignInCancelled: Bool { code == .auth && message == FlintError.googleCancelledMessage }
}

public struct GoogleAuthorizationRequest: Hashable, Sendable {
    public let url: URL
    public let state: String
    public let pkce: PKCE
    /// Pass to `ASWebAuthenticationSession(callback: .customScheme(...))`.
    public let callbackScheme: String
}

public struct GoogleTokens: Hashable, Sendable {
    public var accessToken: String
    public var refreshToken: String
    public var expiresAt: EpochMs
}

public struct GoogleSignIn: Hashable, Sendable {
    public var accessToken: String
    public var refreshToken: String
    public var expiresAt: EpochMs
    public var email: String
    public var name: String
    /// Profile picture URL from the ID token, when Google sent one.
    public var picture: String?
}

private let accountDetailsMissing = "Google did not return account details. Try signing in again."

/// Reads email, name and picture from the ID token payload. The token came straight from Google's token endpoint over TLS,
/// so the signature is not checked (same as desktop).
public func parseGoogleIDToken(_ idToken: String) throws -> (email: String, name: String, picture: String?) {
    let parts = idToken.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count >= 2, let data = Data(base64URLString: String(parts[1])),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let email = object["email"] as? String
    else { throw FlintError(.auth, accountDetailsMissing) }
    return (email.lowercased(), (object["name"] as? String) ?? "", object["picture"] as? String)
}

/// Validates the redirect Google sends back and returns the authorization code.
public func extractAuthorizationCode(from callback: URL, expectedState: String) throws -> String {
    let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
    guard value("state") == expectedState else { throw FlintError(.auth, "Google sign-in could not be verified. Try again.") }
    if let error = value("error") {
        throw error == "access_denied" ? FlintError.googleSignInCancelled : FlintError(.auth, "Google sign-in failed.")
    }
    guard let code = value("code"), !code.isEmpty else { throw FlintError(.auth, "Google sign-in could not be verified. Try again.") }
    return code
}

public struct GoogleOAuthClient: Sendable {
    public var config: GoogleOAuthConfig
    public var http: HTTPClient
    public var now: @Sendable () -> Date
    public var randomBytes: @Sendable (Int) -> [UInt8]

    public static let systemRandomBytes: @Sendable (Int) -> [UInt8] = { n in (0..<n).map { _ in UInt8.random(in: .min ... .max) } }

    public init(
        config: GoogleOAuthConfig, http: HTTPClient = .live, now: @escaping @Sendable () -> Date = { Date() },
        randomBytes: @escaping @Sendable (Int) -> [UInt8] = GoogleOAuthClient.systemRandomBytes
    ) {
        self.config = config
        self.http = http
        self.now = now
        self.randomBytes = randomBytes
    }

    public func authorizationRequest(loginHint: String?) -> GoogleAuthorizationRequest {
        let pkce = PKCE.make(randomBytes: randomBytes)
        let state = Data(randomBytes(16)).base64URLString
        var components = URLComponents(url: GoogleOAuthConfig.authURL, resolvingAgainstBaseURL: false)!
        var items = [
            URLQueryItem(name: "client_id", value: config.clientId),
            URLQueryItem(name: "redirect_uri", value: config.redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: GoogleOAuthConfig.scopes),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "consent"),
            URLQueryItem(name: "state", value: state),
        ]
        if let loginHint, !loginHint.isEmpty { items.append(URLQueryItem(name: "login_hint", value: loginHint)) }
        components.queryItems = items
        return GoogleAuthorizationRequest(url: components.url!, state: state, pkce: pkce, callbackScheme: config.redirectScheme)
    }

    /// Code exchange for a public client: PKCE verifier instead of a client secret.
    public func exchange(code: String, request: GoogleAuthorizationRequest) async throws -> GoogleSignIn {
        let t = try await postToken([
            "code": code, "client_id": config.clientId, "redirect_uri": config.redirectURI,
            "grant_type": "authorization_code", "code_verifier": request.pkce.verifier,
        ])
        guard let refresh = t.refresh_token else {
            throw FlintError(.auth, "Google did not return a refresh token. Remove Flint from your Google account permissions and try again.")
        }
        guard let idToken = t.id_token else { throw FlintError(.auth, accountDetailsMissing) }
        let who = try parseGoogleIDToken(idToken)
        return GoogleSignIn(
            accessToken: t.access_token, refreshToken: refresh, expiresAt: expiry(t.expires_in),
            email: who.email, name: who.name, picture: who.picture)
    }

    /// Google may rotate the refresh token; the old one is kept when the response has none.
    public func refresh(refreshToken: String) async throws -> GoogleTokens {
        let t = try await postToken(["client_id": config.clientId, "refresh_token": refreshToken, "grant_type": "refresh_token"])
        return GoogleTokens(accessToken: t.access_token, refreshToken: t.refresh_token ?? refreshToken, expiresAt: expiry(t.expires_in))
    }

    private func expiry(_ expiresIn: Double?) -> EpochMs {
        Int(now().timeIntervalSince1970 * 1000) + Int((expiresIn ?? 3600) * 1000)
    }

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String?
        let expires_in: Double?
        let id_token: String?
    }

    private struct ErrorResponse: Decodable { let error: String? }

    private func postToken(_ params: [String: String]) async throws -> TokenResponse {
        let response: HTTPResponse
        do { response = try await http.postForm(GoogleOAuthConfig.tokenURL, params) }
        catch { throw FlintError(.network, "Could not reach Google. Check your connection and try again.") }
        guard (200..<300).contains(response.status) else {
            if response.status >= 500 || response.status == 429 { throw FlintError(.network, "Google is temporarily unavailable. Flint will try again.") }
            let code = (try? JSONDecoder().decode(ErrorResponse.self, from: response.body))?.error
            if code == "invalid_grant" { throw FlintError(.auth, "Google sign-in expired. Sign in again.") }
            throw FlintError(.auth, "Google rejected the sign-in\(code.map { " (\($0))" } ?? "").")
        }
        guard let token = try? JSONDecoder().decode(TokenResponse.self, from: response.body) else {
            throw FlintError(.auth, "Google sent a response Flint could not read. Try signing in again.")
        }
        return token
    }
}

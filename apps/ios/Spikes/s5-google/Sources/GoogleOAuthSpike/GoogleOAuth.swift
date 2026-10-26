// Spike S5: iOS Google OAuth (public client, PKCE, no secret). Port of packages/core/src/mail/google-oauth.ts. Throwaway.
import CryptoKit
import Foundation

public enum GoogleOAuthError: Error, Equatable {
    case cancelled, stateMismatch, denied(String), missingCode, network, expired, rejected(String?), noRefreshToken, noAccountDetails
}

public struct GoogleOAuthConfig: Sendable {
    public static let authURL = URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    public static let tokenURL = URL(string: "https://oauth2.googleapis.com/token")!
    public static let scopes = "https://mail.google.com/ openid email profile"
    /// Refresh this long before the access token expires.
    public static let refreshMargin: TimeInterval = 5 * 60

    public let clientId: String
    public init(clientId: String) { self.clientId = clientId }

    /// `123-abc.apps.googleusercontent.com` -> `com.googleusercontent.apps.123-abc`
    public var redirectScheme: String {
        let suffix = ".apps.googleusercontent.com"
        let prefix = clientId.hasSuffix(suffix) ? String(clientId.dropLast(suffix.count)) : clientId
        return "com.googleusercontent.apps." + prefix
    }
    public var redirectURI: String { redirectScheme + ":/oauth2redirect" }
}

public struct PKCE: Sendable, Equatable {
    public let verifier: String
    public let challenge: String
    public static func make(randomBytes: [UInt8]? = nil) -> PKCE {
        let bytes = randomBytes ?? (0..<32).map { _ in UInt8.random(in: .min ... .max) }
        let verifier = Data(bytes).base64URL
        return PKCE(verifier: verifier, challenge: Data(SHA256.hash(data: Data(verifier.utf8))).base64URL)
    }
}

public extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    init?(base64URL s: String) {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        self.init(base64Encoded: b)
    }
}

public func buildAuthURL(_ cfg: GoogleOAuthConfig, pkce: PKCE, state: String, loginHint: String? = nil) -> URL {
    var c = URLComponents(url: GoogleOAuthConfig.authURL, resolvingAgainstBaseURL: false)!
    var items = [
        URLQueryItem(name: "client_id", value: cfg.clientId), URLQueryItem(name: "redirect_uri", value: cfg.redirectURI),
        URLQueryItem(name: "response_type", value: "code"), URLQueryItem(name: "scope", value: GoogleOAuthConfig.scopes),
        URLQueryItem(name: "code_challenge", value: pkce.challenge), URLQueryItem(name: "code_challenge_method", value: "S256"),
        URLQueryItem(name: "access_type", value: "offline"), URLQueryItem(name: "prompt", value: "consent"), URLQueryItem(name: "state", value: state),
    ]
    if let loginHint { items.append(URLQueryItem(name: "login_hint", value: loginHint)) }
    c.queryItems = items
    return c.url!
}

/// Validates the redirect Google sends back and returns the authorization code.
public func extractCode(from callback: URL, expectedState: String) throws -> String {
    let q = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func v(_ n: String) -> String? { q.first { $0.name == n }?.value }
    guard v("state") == expectedState else { throw GoogleOAuthError.stateMismatch }
    if let e = v("error") { throw e == "access_denied" ? GoogleOAuthError.cancelled : GoogleOAuthError.denied(e) }
    guard let code = v("code"), !code.isEmpty else { throw GoogleOAuthError.missingCode }
    return code
}

public typealias FormPost = @Sendable (URL, [String: String]) async throws -> (status: Int, body: Data)

public struct GoogleTokens: Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date
    public let scope: String?
    public init(accessToken: String, refreshToken: String, expiresAt: Date, scope: String?) {
        self.accessToken = accessToken; self.refreshToken = refreshToken; self.expiresAt = expiresAt; self.scope = scope
    }
}
public struct GoogleSignIn: Sendable, Equatable { public let tokens: GoogleTokens; public let email: String; public let name: String }

private struct TokenResponse: Decodable {
    let access_token: String; let refresh_token: String?; let expires_in: Double?; let id_token: String?; let scope: String?
}
private struct ErrorResponse: Decodable { let error: String? }

private func postToken(_ post: FormPost, _ params: [String: String]) async throws -> TokenResponse {
    let (status, body): (Int, Data)
    do { (status, body) = try await post(GoogleOAuthConfig.tokenURL, params) } catch { throw GoogleOAuthError.network }
    guard (200..<300).contains(status) else {
        let code = (try? JSONDecoder().decode(ErrorResponse.self, from: body))?.error
        if status >= 500 || status == 429 { throw GoogleOAuthError.network }
        if code == "invalid_grant" { throw GoogleOAuthError.expired }
        throw GoogleOAuthError.rejected(code)
    }
    return try JSONDecoder().decode(TokenResponse.self, from: body)
}

public func parseIDToken(_ idToken: String) throws -> (email: String, name: String) {
    let parts = idToken.split(separator: ".")
    guard parts.count >= 2, let data = Data(base64URL: String(parts[1])),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let email = obj["email"] as? String
    else { throw GoogleOAuthError.noAccountDetails }
    return (email.lowercased(), (obj["name"] as? String) ?? "")
}

/// Code exchange for a public client: no client_secret, PKCE verifier instead.
public func exchangeCode(_ code: String, cfg: GoogleOAuthConfig, pkce: PKCE, post: FormPost, now: Date = Date()) async throws -> GoogleSignIn {
    let t = try await postToken(post, [
        "code": code, "client_id": cfg.clientId, "redirect_uri": cfg.redirectURI, "grant_type": "authorization_code", "code_verifier": pkce.verifier,
    ])
    guard let refresh = t.refresh_token else { throw GoogleOAuthError.noRefreshToken }
    guard let idToken = t.id_token else { throw GoogleOAuthError.noAccountDetails }
    let who = try parseIDToken(idToken)
    return GoogleSignIn(tokens: GoogleTokens(accessToken: t.access_token, refreshToken: refresh, expiresAt: now.addingTimeInterval(t.expires_in ?? 3600), scope: t.scope), email: who.email, name: who.name)
}

/// Google may rotate the refresh token; the old one is kept when the response has none.
public func refresh(_ tokens: GoogleTokens, cfg: GoogleOAuthConfig, post: FormPost, now: Date = Date()) async throws -> GoogleTokens {
    let t = try await postToken(post, ["client_id": cfg.clientId, "refresh_token": tokens.refreshToken, "grant_type": "refresh_token"])
    return GoogleTokens(accessToken: t.access_token, refreshToken: t.refresh_token ?? tokens.refreshToken, expiresAt: now.addingTimeInterval(t.expires_in ?? 3600), scope: t.scope ?? tokens.scope)
}

public func needsRefresh(_ tokens: GoogleTokens, now: Date = Date()) -> Bool {
    tokens.expiresAt.timeIntervalSince(now) <= GoogleOAuthConfig.refreshMargin
}

/// Standard URLSession implementation of `FormPost`.
public let urlSessionFormPost: FormPost = { url, params in
    var r = URLRequest(url: url); r.httpMethod = "POST"
    r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-._~")
    r.httpBody = Data(params.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }.sorted().joined(separator: "&").utf8)
    let (data, resp) = try await URLSession.shared.data(for: r)
    return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
}

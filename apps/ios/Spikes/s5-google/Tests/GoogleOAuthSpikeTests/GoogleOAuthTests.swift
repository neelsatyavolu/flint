import Foundation
import Testing
@testable import GoogleOAuthSpike

private let cfg = GoogleOAuthConfig(clientId: "617596563618-84523hu1pellgad03t263u2mqig2i45i.apps.googleusercontent.com")

private func idToken(email: String, name: String) -> String {
    let payload = try! JSONSerialization.data(withJSONObject: ["email": email, "name": name])
    return "x.\(payload.base64URL).y"
}
private func ok(_ obj: [String: Any]) -> (Int, Data) { (200, try! JSONSerialization.data(withJSONObject: obj)) }

@Suite struct GoogleOAuthTests {
    @Test func redirectSchemeIsReversedClientId() {
        #expect(cfg.redirectScheme == "com.googleusercontent.apps.617596563618-84523hu1pellgad03t263u2mqig2i45i")
        #expect(cfg.redirectURI == cfg.redirectScheme + ":/oauth2redirect")
    }
    @Test func pkceMatchesRFC7636Vector() {
        // RFC 7636 appendix B: verifier dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk -> E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
        let bytes: [UInt8] = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]
        let p = PKCE.make(randomBytes: bytes)
        #expect(p.verifier == "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        #expect(p.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }
    @Test func authURLCarriesRequiredParameters() {
        let u = buildAuthURL(cfg, pkce: PKCE.make(), state: "st", loginHint: "a@b.c")
        let q = Dictionary(uniqueKeysWithValues: URLComponents(url: u, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value ?? "") })
        #expect(q["code_challenge_method"] == "S256"); #expect(q["access_type"] == "offline"); #expect(q["prompt"] == "consent")
        #expect(q["scope"] == "https://mail.google.com/ openid email profile"); #expect(q["login_hint"] == "a@b.c")
        #expect(q["redirect_uri"] == cfg.redirectURI); #expect(q["client_secret"] == nil)
    }
    @Test func callbackValidation() throws {
        let base = cfg.redirectURI
        #expect(try extractCode(from: URL(string: base + "?code=abc&state=s")!, expectedState: "s") == "abc")
        #expect(throws: GoogleOAuthError.stateMismatch) { try extractCode(from: URL(string: base + "?code=abc&state=zzz")!, expectedState: "s") }
        #expect(throws: GoogleOAuthError.cancelled) { try extractCode(from: URL(string: base + "?error=access_denied&state=s")!, expectedState: "s") }
        #expect(throws: GoogleOAuthError.denied("server_error")) { try extractCode(from: URL(string: base + "?error=server_error&state=s")!, expectedState: "s") }
        #expect(throws: GoogleOAuthError.missingCode) { try extractCode(from: URL(string: base + "?state=s")!, expectedState: "s") }
    }
    @Test func exchangeSendsNoSecretAndParsesTokens() async throws {
        let seen = Box<[String: String]>([:])
        let post: FormPost = { url, p in
            seen.value = p
            #expect(url == GoogleOAuthConfig.tokenURL)
            return ok(["access_token": "at", "refresh_token": "rt", "expires_in": 3599, "id_token": idToken(email: "Me@Example.com", name: "Me"), "scope": "s"])
        }
        let pkce = PKCE.make()
        let now = Date(timeIntervalSince1970: 1_000)
        let r = try await exchangeCode("code1", cfg: cfg, pkce: pkce, post: post, now: now)
        #expect(r.email == "me@example.com"); #expect(r.tokens.refreshToken == "rt"); #expect(r.tokens.expiresAt == now.addingTimeInterval(3599))
        #expect(seen.value["client_secret"] == nil); #expect(seen.value["code_verifier"] == pkce.verifier)
        #expect(seen.value["grant_type"] == "authorization_code")
    }
    @Test func exchangeWithoutRefreshTokenFails() async {
        let post: FormPost = { _, _ in ok(["access_token": "at", "id_token": idToken(email: "a@b.c", name: "")]) }
        await #expect(throws: GoogleOAuthError.noRefreshToken) { try await exchangeCode("c", cfg: cfg, pkce: .make(), post: post) }
    }
    @Test func refreshKeepsOldRefreshTokenAndMapsErrors() async throws {
        let t = GoogleTokens(accessToken: "old", refreshToken: "rt", expiresAt: .distantPast, scope: "s")
        let r = try await refresh(t, cfg: cfg, post: { _, _ in ok(["access_token": "new", "expires_in": 3600]) })
        #expect(r.accessToken == "new"); #expect(r.refreshToken == "rt")
        await #expect(throws: GoogleOAuthError.expired) { try await refresh(t, cfg: cfg, post: { _, _ in (400, Data(#"{"error":"invalid_grant"}"#.utf8)) }) }
        await #expect(throws: GoogleOAuthError.network) { try await refresh(t, cfg: cfg, post: { _, _ in (503, Data()) }) }
        await #expect(throws: GoogleOAuthError.network) { try await refresh(t, cfg: cfg, post: { _, _ in throw URLError(.notConnectedToInternet) }) }
        await #expect(throws: GoogleOAuthError.rejected("invalid_client")) { try await refresh(t, cfg: cfg, post: { _, _ in (401, Data(#"{"error":"invalid_client"}"#.utf8)) }) }
    }
    @Test func refreshMargin() {
        let now = Date(timeIntervalSince1970: 10_000)
        func t(_ s: TimeInterval) -> GoogleTokens { GoogleTokens(accessToken: "a", refreshToken: "r", expiresAt: now.addingTimeInterval(s), scope: nil) }
        #expect(needsRefresh(t(299), now: now)); #expect(!needsRefresh(t(301), now: now))
    }
}

final class Box<T>: @unchecked Sendable { var value: T; init(_ v: T) { value = v } }

import FlintMail
import FlintModel
import Foundation
import Testing

private let clientId = "617596563618-84523hu1pellgad03t263u2mqig2i45i.apps.googleusercontent.com"
private let tokenURL = "https://oauth2.googleapis.com/token"
private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

private func b64url(_ s: String) -> String {
    Data(s.utf8).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

private func idToken(email: String = "Me@Gmail.com", name: String? = "Nuño Ünal", picture: String? = nil) -> String {
    var claims = "\"email\":\"\(email)\""
    if let name { claims += ",\"name\":\"\(name)\"" }
    if let picture { claims += ",\"picture\":\"\(picture)\"" }
    return "\(b64url("{\"alg\":\"RS256\"}")).\(b64url("{\(claims)}")).sig"
}

private func tokenBody(refresh: String? = "rt-1", id: String? = idToken(), expiresIn: Int = 3599) -> String {
    var parts = ["\"access_token\":\"at-1\"", "\"expires_in\":\(expiresIn)", "\"scope\":\"https://mail.google.com/\""]
    if let refresh { parts.append("\"refresh_token\":\"\(refresh)\"") }
    if let id { parts.append("\"id_token\":\"\(id)\"") }
    return "{\(parts.joined(separator: ","))}"
}

private func client(_ http: ScriptedHTTP, now: Date = t0) -> GoogleOAuthClient {
    GoogleOAuthClient(config: GoogleOAuthConfig(clientId: clientId), http: http.client, now: { now }, randomBytes: { n in Array(repeating: 7, count: n) })
}

@Suite("Auth Google OAuth")
struct AuthGoogleOAuthTests {
    @Test func redirectUsesReversedClientId() {
        let cfg = GoogleOAuthConfig(clientId: clientId)
        #expect(cfg.redirectScheme == "com.googleusercontent.apps.617596563618-84523hu1pellgad03t263u2mqig2i45i")
        #expect(cfg.redirectURI == "com.googleusercontent.apps.617596563618-84523hu1pellgad03t263u2mqig2i45i:/oauth2redirect")
    }

    @Test func pkceMatchesRFC7636Vector() {
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        #expect(pkce.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func generatedPkceIsUrlSafeAndLongEnough() {
        let pkce = PKCE.make()
        #expect(pkce.verifier.count >= 43)
        #expect(!pkce.verifier.contains(where: { "+/=".contains($0) }))
        #expect(PKCE.make().verifier != pkce.verifier)
    }

    @Test func authorizationRequestCarriesTheDesktopParameters() async throws {
        let request = client(ScriptedHTTP()).authorizationRequest(loginHint: "me@gmail.com")
        let items = Dictionary(uniqueKeysWithValues: (URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        #expect(request.url.host == "accounts.google.com")
        #expect(items["client_id"] == clientId)
        #expect(items["response_type"] == "code")
        #expect(items["scope"] == "https://mail.google.com/ openid email profile")
        #expect(items["access_type"] == "offline")
        #expect(items["prompt"] == "consent")
        #expect(items["code_challenge_method"] == "S256")
        #expect(items["code_challenge"] == request.pkce.challenge)
        #expect(items["state"] == request.state)
        #expect(items["login_hint"] == "me@gmail.com")
        #expect(items["redirect_uri"] == "com.googleusercontent.apps.617596563618-84523hu1pellgad03t263u2mqig2i45i:/oauth2redirect")
        #expect(items["client_secret"] == nil)
        #expect(request.callbackScheme == "com.googleusercontent.apps.617596563618-84523hu1pellgad03t263u2mqig2i45i")
    }

    @Test func loginHintIsOptional() {
        let request = client(ScriptedHTTP()).authorizationRequest(loginHint: nil)
        #expect(!request.url.absoluteString.contains("login_hint"))
    }

    @Test func eachRequestHasFreshStateAndVerifier() {
        let c = GoogleOAuthClient(config: GoogleOAuthConfig(clientId: clientId), http: ScriptedHTTP().client)
        let a = c.authorizationRequest(loginHint: nil), b = c.authorizationRequest(loginHint: nil)
        #expect(a.state != b.state)
        #expect(a.pkce.verifier != b.pkce.verifier)
    }

    // MARK: callback

    private func callback(_ query: String) -> URL { URL(string: "com.googleusercontent.apps.x:/oauth2redirect?\(query)")! }

    @Test func extractsCode() throws {
        #expect(try extractAuthorizationCode(from: callback("code=4%2Fabc&state=S"), expectedState: "S") == "4/abc")
    }

    @Test func rejectsWrongState() {
        do { _ = try extractAuthorizationCode(from: callback("code=c&state=OTHER"), expectedState: "S"); Issue.record("should throw") }
        catch let e as FlintError { #expect(e.code == .auth); #expect(!e.isGoogleSignInCancelled) } catch { Issue.record("wrong error") }
    }

    @Test func accessDeniedIsCancellation() {
        do { _ = try extractAuthorizationCode(from: callback("error=access_denied&state=S"), expectedState: "S"); Issue.record("should throw") }
        catch let e as FlintError { #expect(e.isGoogleSignInCancelled); #expect(e.message == "Google sign-in was cancelled.") } catch { Issue.record("wrong error") }
    }

    @Test func otherErrorsAreFailures() {
        do { _ = try extractAuthorizationCode(from: callback("error=server_error&state=S"), expectedState: "S"); Issue.record("should throw") }
        catch let e as FlintError { #expect(!e.isGoogleSignInCancelled); #expect(e.message == "Google sign-in failed.") } catch { Issue.record("wrong error") }
    }

    @Test func missingCodeFails() {
        #expect(throws: FlintError.self) { try extractAuthorizationCode(from: callback("state=S"), expectedState: "S") }
        #expect(throws: FlintError.self) { try extractAuthorizationCode(from: callback("code=&state=S"), expectedState: "S") }
    }

    // MARK: exchange

    @Test func exchangePostsPublicClientParametersAndParsesResult() async throws {
        let http = ScriptedHTTP()
        await http.enqueue(tokenURL, status: 200, json: tokenBody())
        let c = client(http)
        let request = c.authorizationRequest(loginHint: nil)
        let signIn = try await c.exchange(code: "4/abc", request: request)
        #expect(signIn.email == "me@gmail.com")
        #expect(signIn.name == "Nuño Ünal")
        #expect(signIn.accessToken == "at-1")
        #expect(signIn.refreshToken == "rt-1")
        #expect(signIn.expiresAt == Int(t0.timeIntervalSince1970 * 1000) + 3_599_000)
        let sent = try #require(await http.requests.first)
        #expect(sent.form["grant_type"] == "authorization_code")
        #expect(sent.form["code"] == "4/abc")
        #expect(sent.form["code_verifier"] == request.pkce.verifier)
        #expect(sent.form["client_id"] == clientId)
        #expect(sent.form["client_secret"] == nil)
        #expect(sent.form["redirect_uri"] == GoogleOAuthConfig(clientId: clientId).redirectURI)
    }

    @Test func exchangeCarriesPictureWhenPresent() async throws {
        let http = ScriptedHTTP()
        await http.enqueue(tokenURL, status: 200, json: tokenBody(id: idToken(picture: "https://lh3.example/p.jpg")))
        let c = client(http)
        let signIn = try await c.exchange(code: "c", request: c.authorizationRequest(loginHint: nil))
        #expect(signIn.picture == "https://lh3.example/p.jpg")
    }

    @Test func exchangeWithoutRefreshTokenFails() async {
        let http = ScriptedHTTP()
        await http.enqueue(tokenURL, status: 200, json: tokenBody(refresh: nil))
        let c = client(http)
        await expectAuthError("Google did not return a refresh token. Remove Flint from your Google account permissions and try again.") {
            _ = try await c.exchange(code: "c", request: c.authorizationRequest(loginHint: nil))
        }
    }

    @Test func exchangeWithoutIdTokenFails() async {
        let http = ScriptedHTTP()
        await http.enqueue(tokenURL, status: 200, json: tokenBody(id: nil))
        let c = client(http)
        await expectAuthError("Google did not return account details. Try signing in again.") {
            _ = try await c.exchange(code: "c", request: c.authorizationRequest(loginHint: nil))
        }
    }

    @Test func tokenEndpointErrorsMapToFlintErrors() async {
        for (status, body, code, text) in [
            (400, #"{"error":"invalid_grant"}"#, FlintErrorCode.auth, "Google sign-in expired. Sign in again."),
            (400, #"{"error":"invalid_client"}"#, .auth, "Google rejected the sign-in (invalid_client)."),
            (400, "not json", .auth, "Google rejected the sign-in."),
            (503, "{}", .network, "Google is temporarily unavailable. Flint will try again."),
            (429, "{}", .network, "Google is temporarily unavailable. Flint will try again."),
        ] {
            let http = ScriptedHTTP()
            await http.enqueue(tokenURL, status: status, json: body)
            let c = client(http)
            do { _ = try await c.exchange(code: "c", request: c.authorizationRequest(loginHint: nil)); Issue.record("should throw \(status)") }
            catch let e as FlintError { #expect(e.code == code, "\(status) \(body)"); #expect(e.message == text, "\(status) \(body)") }
            catch { Issue.record("wrong error") }
        }
    }

    @Test func transportFailureIsNetworkError() async {
        let http = ScriptedHTTP()
        await http.enqueueFailure(tokenURL)
        let c = client(http)
        do { _ = try await c.exchange(code: "c", request: c.authorizationRequest(loginHint: nil)); Issue.record("should throw") }
        catch let e as FlintError { #expect(e.code == .network); #expect(e.message == "Could not reach Google. Check your connection and try again.") }
        catch { Issue.record("wrong error") }
    }

    // MARK: refresh

    @Test func refreshKeepsOldRefreshTokenWhenGoogleSendsNone() async throws {
        let http = ScriptedHTTP()
        await http.enqueue(tokenURL, status: 200, json: #"{"access_token":"at-2","expires_in":3600}"#)
        let next = try await client(http).refresh(refreshToken: "rt-old")
        #expect(next.accessToken == "at-2")
        #expect(next.refreshToken == "rt-old")
        #expect(next.expiresAt == Int(t0.timeIntervalSince1970 * 1000) + 3_600_000)
        let sent = try #require(await http.requests.first)
        #expect(sent.form == ["client_id": clientId, "refresh_token": "rt-old", "grant_type": "refresh_token"])
    }

    @Test func refreshAdoptsRotatedRefreshToken() async throws {
        let http = ScriptedHTTP()
        await http.enqueue(tokenURL, status: 200, json: #"{"access_token":"at-2","refresh_token":"rt-new","expires_in":3600}"#)
        #expect(try await client(http).refresh(refreshToken: "rt-old").refreshToken == "rt-new")
    }

    @Test func refreshMarginIsFiveMinutes() {
        let now = 1_000_000
        #expect(GoogleOAuthConfig.needsRefresh(expiresAt: now + 5 * 60 * 1000, nowMs: now))
        #expect(!GoogleOAuthConfig.needsRefresh(expiresAt: now + 5 * 60 * 1000 + 1, nowMs: now))
        #expect(GoogleOAuthConfig.needsRefresh(expiresAt: now - 1, nowMs: now))
    }

    // MARK: id token

    @Test func idTokenLowercasesEmailAndAllowsMissingName() throws {
        let who = try parseGoogleIDToken(idToken(email: "A.B@Example.COM", name: nil))
        #expect(who.email == "a.b@example.com")
        #expect(who.name == "")
    }

    @Test func malformedIdTokenIsAuthError() {
        for bad in ["", "abc", "a.b.c", "a.\(b64url("{}")).c", "a.\(b64url("[1]")).c"] {
            do { _ = try parseGoogleIDToken(bad); Issue.record("should throw for \(bad)") }
            catch let e as FlintError { #expect(e.code == .auth); #expect(e.message == "Google did not return account details. Try signing in again.") }
            catch { Issue.record("wrong error") }
        }
    }

    @Test func formEncodingEscapesReservedCharacters() {
        #expect(formEncode(["b": "a b&c=d/é", "a": "1"]) == "a=1&b=a%20b%26c%3Dd%2F%C3%A9")
    }
}

func expectAuthError(_ message: String, code: FlintErrorCode = .auth, _ body: () async throws -> Void) async {
    do { try await body(); Issue.record("should throw") }
    catch let e as FlintError { #expect(e.code == code); #expect(e.message == message) }
    catch { Issue.record("wrong error \(error)") }
}

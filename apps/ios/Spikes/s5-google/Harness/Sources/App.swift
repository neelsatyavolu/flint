// Spike S5 harness: live Google round trip. Needs a human at the browser sheet (owner gate). Throwaway.
// Writes only non-secret facts to the screen and to Documents/s5-result.txt. Tokens live in the Keychain, never in logs.
import SwiftUI
import AuthenticationServices
import Security
import GoogleOAuthSpike
import SwiftMail

let cfg = GoogleOAuthConfig(clientId: "617596563618-84523hu1pellgad03t263u2mqig2i45i.apps.googleusercontent.com")

enum Keychain {
    static func save(_ s: String, _ key: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key]
        SecItemDelete(q as CFDictionary)
        SecItemAdd(q.merging([kSecValueData as String: Data(s.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]) { $1 } as CFDictionary, nil)
    }
    static func load(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key, kSecReturnData as String: true]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
}

@MainActor final class Model: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published var lines: [String] = ["Tap Sign in. Results are non-secret facts only."]
    private var session: ASWebAuthenticationSession?
    func note(_ s: String) {
        lines.append(s)
        let url = URL.documentsDirectory.appending(path: "s5-result.txt")
        let text = lines.joined(separator: "\n")
        try? text.write(to: url, atomically: true, encoding: .utf8)
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }

    func signIn() {
        let pkce = PKCE.make(); let state = PKCE.make().challenge
        let url = buildAuthURL(cfg, pkce: pkce, state: state)
        let s = ASWebAuthenticationSession(url: url, callback: .customScheme(cfg.redirectScheme)) { [weak self] cb, err in
            Task { @MainActor in
                guard let self else { return }
                guard let cb else { self.note("S5.1 auth session: no callback (\((err as NSError?).map { "\($0.domain)#\($0.code)" } ?? "?"))"); return }
                self.note("S5.1 auth session returned custom-scheme callback: yes")
                do {
                    let code = try extractCode(from: cb, expectedState: state)
                    let r = try await exchangeCode(code, cfg: cfg, pkce: pkce, post: urlSessionFormPost)
                    Keychain.save(r.tokens.refreshToken, "s5.refresh"); Keychain.save(r.email, "s5.email")
                    UserDefaults.standard.set(Date(), forKey: "s5.signedInAt")
                    self.note("S5.2 token exchange without client secret: ok, refresh token present: yes, access token lifetime \(Int(r.tokens.expiresAt.timeIntervalSinceNow)) s, scope granted: \(r.tokens.scope ?? "?")")
                    await self.gmailProbe(email: r.email, accessToken: r.tokens.accessToken)
                } catch { self.note("S5.2 failed: \(error)") }
            }
        }
        s.presentationContextProvider = self
        session = s
        note("S5.0 start() -> \(s.start())")
    }

    func gmailProbe(email: String, accessToken: String) async {
        let imap = IMAPServer(host: "imap.gmail.com", port: 993, transportSecurity: .implicitTLS)
        do {
            try await imap.connect()
            try await imap.authenticateXOAUTH2(email: email, accessToken: accessToken)
            let caps = try await imap.fetchCapabilities().map { String(describing: $0) }
            let sel = try await imap.selectMailbox("INBOX")
            note("S5.3 IMAP XOAUTH2 to imap.gmail.com: ok, INBOX count \(sel.messageCount), X-GM-EXT-1 advertised: \(caps.contains { $0.contains("X-GM-EXT-1") }), CONDSTORE: \(caps.contains { $0.contains("CONDSTORE") }), QRESYNC: \(caps.contains { $0.contains("QRESYNC") })")
            try? await imap.logout()
        } catch { note("S5.3 IMAP XOAUTH2 failed: \(error)") }
    }

    /// Run on later days (day 1, 3, 7, 8) to record refresh-token behavior in the unverified production state.
    func refreshNow() async {
        guard let rt = Keychain.load("s5.refresh") else { note("S5.4 no stored refresh token"); return }
        let age = (UserDefaults.standard.object(forKey: "s5.signedInAt") as? Date).map { Date().timeIntervalSince($0) / 86_400 } ?? -1
        do {
            let t = try await refresh(GoogleTokens(accessToken: "", refreshToken: rt, expiresAt: .distantPast, scope: nil), cfg: cfg, post: urlSessionFormPost)
            note(String(format: "S5.4 refresh after %.2f days: ok, rotated refresh token: %@", age, t.refreshToken == rt ? "no" : "yes"))
            if t.refreshToken != rt { Keychain.save(t.refreshToken, "s5.refresh") }
        } catch { note(String(format: "S5.4 refresh after %.2f days failed: %@", age, "\(error)")) }
    }
}

@main struct HarnessApp: App {
    @StateObject var m = Model()
    var body: some Scene {
        WindowGroup {
            VStack(alignment: .leading, spacing: 12) {
                Button("Sign in with Google") { m.signIn() }.accessibilityIdentifier("signIn")
                Button("Refresh token now") { Task { await m.refreshNow() } }.accessibilityIdentifier("refresh")
                ScrollView { Text(m.lines.joined(separator: "\n")).font(.system(size: 12, design: .monospaced)).frame(maxWidth: .infinity, alignment: .leading) }
            }.padding()
        }
    }
}

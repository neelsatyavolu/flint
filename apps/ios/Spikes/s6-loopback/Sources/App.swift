// Spike S6: can an in-app NWListener on loopback catch the redirect of an ASWebAuthenticationSession? Throwaway.
import SwiftUI
import Network
import AuthenticationServices

func log(_ s: String) {
    let url = URL.documentsDirectory.appending(path: "s6.log")
    let line = "\(Date().formatted(.iso8601)) \(s)\n"
    if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() }
    else { try? line.write(to: url, atomically: true, encoding: .utf8) }
}

final class Loopback: NSObject, ASWebAuthenticationPresentationContextProviding, @unchecked Sendable {
    var listener: NWListener?
    var session: ASWebAuthenticationSession?
    func start(port: UInt16, redirectHost: String, startURL: URL) {
        do {
            let l = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
            l.newConnectionHandler = { c in
                c.start(queue: .global())
                c.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
                    let first = data.flatMap { String(data: $0, encoding: .utf8) }?.split(separator: "\r\n").first.map(String.init) ?? "?"
                    // log only the request line shape, never query values
                    let path = first.split(separator: " ").dropFirst().first.map { String($0.split(separator: "?").first ?? "") } ?? "?"
                    let hasCode = first.contains("code=")
                    log("LISTENER got request path=\(path) hasCode=\(hasCode) from \(c.endpoint)")
                    let body = "<html><body>Signed in. You can return to Flint.</body></html>"
                    let resp = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
                    c.send(content: Data(resp.utf8), completion: .contentProcessed { _ in c.cancel() })
                }
            }
            l.stateUpdateHandler = { log("LISTENER state \($0)") }
            l.start(queue: .global())
            listener = l
        } catch { log("LISTENER failed \(error)"); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [self] in
            let s = ASWebAuthenticationSession(url: startURL, callback: .customScheme("flintspike")) { url, error in
                log("SESSION completion url=\(url != nil) error=\((error as NSError?).map { "\($0.domain)#\($0.code)" } ?? "nil")")
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = true
            session = s
            log("SESSION start() -> \(s.start())")
        }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }
}

@main struct SpikeApp: App {
    let lb = Loopback()
    init() {
        let host = UserDefaults.standard.string(forKey: "redirectHost") ?? "localhost"
        let port = UInt16(UserDefaults.standard.integer(forKey: "port") == 0 ? 1455 : UserDefaults.standard.integer(forKey: "port"))
        let start = URL(string: "http://127.0.0.1:8099/start?host=\(host)&port=\(port)")!
        lb.start(port: port, redirectHost: host, startURL: start)
    }
    var body: some Scene { WindowGroup { Text("S6 loopback spike").padding() } }
}

// "Unsubscribe": an RFC 8058 one-click POST when the mail offers one, else a mailto sent from the account, else the link
// for the UI to open. Port of packages/core/src/service/unsubscribe.ts.

import FlintMail
import FlintModel
import FlintStore
import Foundation

/// How an unsubscribe went. `.browser` carries the http or https address the UI should open.
public enum UnsubscribeMethod: Hashable, Sendable {
    case oneClick
    case mailto
    case browser(URL)
}

enum UnsubscribeSafety {
    private static func isPrivateV4(_ a: Int, _ b: Int, _ c: Int) -> Bool {
        a == 0 || a == 10 || a == 127 || a >= 224 || (a == 100 && (64...127).contains(b)) || (a == 169 && b == 254)
            || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168) || (a == 192 && b == 0 && c == 0) || (a == 198 && (b == 18 || b == 19))
    }

    /// True for an address routable on the public internet (IPv4 or IPv6, as text).
    static func isPublicAddress(_ ip: String) -> Bool {
        let v4 = ip.split(separator: ".").compactMap { Int($0) }
        if v4.count == 4, ip.allSatisfy({ $0.isNumber || $0 == "." }) { return !isPrivateV4(v4[0], v4[1], v4[2]) }
        let v6 = ip.lowercased()
        guard v6.contains(":") else { return false }
        if v6 == "::" || v6 == "::1" { return false }
        if let mapped = v6.range(of: #"^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$"#, options: .regularExpression) {
            return isPublicAddress(String(v6[mapped]).replacingOccurrences(of: "::ffff:", with: "").replacingOccurrences(of: "64:ff9b::", with: ""))
        }
        let first = Int(v6.split(separator: ":", omittingEmptySubsequences: false).first.flatMap { $0.isEmpty ? "0" : String($0) } ?? "0", radix: 16) ?? 0
        return !((first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80 || (first & 0xff00) == 0xff00 || v6.hasPrefix("::ffff:"))
    }

    /// One-click POSTs come from the mail itself, so never send them to this device's network.
    static func isPublicHTTPS(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased(), !host.isEmpty else { return false }
        if host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".local") || host.hasSuffix(".internal") { return false }
        if host.contains(":") { return false }
        let v4 = host.split(separator: ".").compactMap { Int($0) }
        if v4.count == 4, host.allSatisfy({ $0.isNumber || $0 == "." }) { return isPublicAddress(host) }
        return true
    }

    /// Every address the name resolves to must be public. A name that does not resolve counts as not public.
    static func resolvesToPublicOnly(_ host: String) async -> Bool {
        await Task.detached {
            var hints = addrinfo()
            hints.ai_family = AF_UNSPEC
            hints.ai_socktype = SOCK_STREAM
            var result: UnsafeMutablePointer<addrinfo>?
            guard getaddrinfo(host, nil, &hints, &result) == 0, let first = result else { return false }
            defer { freeaddrinfo(result) }
            var any = false
            var cursor: UnsafeMutablePointer<addrinfo>? = first
            while let entry = cursor {
                var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                if getnameinfo(entry.pointee.ai_addr, entry.pointee.ai_addrlen, &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 {
                    any = true
                    let text = String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
                    if !isPublicAddress(text) { return false }
                }
                cursor = entry.pointee.ai_next
            }
            return any
        }.value
    }
}

extension ServiceCore {
    func unsubscribe(_ messageId: MessageRowID) async throws -> UnsubscribeMethod {
        guard let message = try await store.message(id: messageId) else { throw FlintError(.notFound, "That message no longer exists.") }
        guard let info = message.unsubscribe else { throw FlintError(.notFound, "This message has no unsubscribe link.") }

        if info.oneClick, let raw = info.url, let url = URL(string: raw), await oneClick(url) { return .oneClick }

        if let raw = info.mailto, let mail = Self.parseMailto(raw) {
            try await sendJob.sendRaw(accountId: message.accountId, to: [Address(address: mail.to)], subject: mail.subject, text: mail.body)
            return .mailto
        }
        // Only a web address goes to the browser. A mailto the parser rejected must never reach Safari's view.
        if let raw = info.url, let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased()) { return .browser(url) }
        throw FlintError(.invalid, "This message's unsubscribe address is not usable.")
    }

    private func oneClick(_ url: URL) async -> Bool {
        guard UnsubscribeSafety.isPublicHTTPS(url), let host = url.host, await UnsubscribeSafety.resolvesToPublicOnly(host) else { return false }
        guard let response = try? await config.http.postFormWithoutRedirects(url, ["List-Unsubscribe": "One-Click"]) else { return false }
        // RFC 8058: any 2xx means the request was accepted.
        return (200..<300).contains(response.status)
    }

    static func parseMailto(_ raw: String) -> (to: String, subject: String, body: String)? {
        guard let components = URLComponents(string: raw), components.scheme?.lowercased() == "mailto" else { return nil }
        let to = components.path.removingPercentEncoding?.trimmingCharacters(in: .whitespaces) ?? ""
        guard !to.isEmpty else { return nil }
        func item(_ name: String) -> String? { components.queryItems?.first { $0.name.lowercased() == name }?.value }
        return (to, item("subject") ?? "unsubscribe", item("body") ?? "unsubscribe")
    }
}

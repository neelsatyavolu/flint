// Mozilla ISPDB / autoconfig XML (track 2C). Port of `parseIspdb` in autoconfig.ts.

import FlintModel
import Foundation

public struct IspdbConfig: Hashable, Sendable {
    public var server: ServerConfig
    public var provider: MailProvider
}

private func firstMatch(_ pattern: String, in text: String) -> [String]? {
    guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
          let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
    else { return nil }
    return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: text).map { String(text[$0]) } ?? "" }
}

private func tag(_ xml: String, _ name: String) -> String? {
    firstMatch("<\(name)>\\s*([^<]*?)\\s*</\(name)>", in: xml)?[1]
}

private func expandUsername(_ template: String?, email: String) -> String {
    guard let template, !template.isEmpty else { return email }
    let parts = email.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
    let local = parts.first ?? "", domain = parts.count > 1 ? parts[1] : ""
    return template
        .replacingOccurrences(of: "%EMAILADDRESS%", with: email, options: .caseInsensitive)
        .replacingOccurrences(of: "%EMAILLOCALPART%", with: local, options: .caseInsensitive)
        .replacingOccurrences(of: "%EMAILDOMAIN%", with: domain, options: .caseInsensitive)
}

private struct Candidate {
    let host: String
    let port: Int
    let socket: String
    let username: String
    var secure: Bool { socket == "SSL" }
}

private func candidates(in xml: String, element: String, type: String, email: String) -> [Candidate] {
    guard let re = try? NSRegularExpression(pattern: "<\(element)\\b[^>]*type=\"\(type)\"[^>]*>([\\s\\S]*?)</\(element)>", options: .caseInsensitive) else { return [] }
    return re.matches(in: xml, range: NSRange(xml.startIndex..., in: xml)).compactMap { m in
        guard let r = Range(m.range(at: 1), in: xml) else { return nil }
        let body = String(xml[r])
        guard let host = tag(body, "hostname"), !host.isEmpty, let port = tag(body, "port").flatMap({ Int($0) }), port != 0 else { return nil }
        return Candidate(host: host, port: port, socket: (tag(body, "socketType") ?? "").uppercased(), username: expandUsername(tag(body, "username"), email: email))
    }
}

private func pick(_ list: [Candidate]) -> Candidate? {
    list.first { $0.socket == "SSL" } ?? list.first { $0.socket == "STARTTLS" }
}

/// Null when the document has no usable IMAP and SMTP server. Plain (unencrypted) servers are never chosen.
public func parseIspdb(xml: String, email: String) -> IspdbConfig? {
    guard let imap = pick(candidates(in: xml, element: "incomingServer", type: "imap", email: email)),
          let smtp = pick(candidates(in: xml, element: "outgoingServer", type: "smtp", email: email))
    else { return nil }
    let isGmail = imap.host.range(of: #"(^|\.)(gmail|googlemail)\.com$"#, options: [.regularExpression, .caseInsensitive]) != nil
    return IspdbConfig(
        server: ServerConfig(
            imapHost: imap.host, imapPort: imap.port, imapSecure: imap.secure,
            smtpHost: smtp.host, smtpPort: smtp.port, smtpSecure: smtp.secure, username: imap.username),
        provider: isGmail ? .gmail : .imap)
}

import FlintModel
import Foundation

/// The editable server fields as text, so a half-typed port never loses what the person typed. `config` is nil until valid.
struct ServerForm: Equatable, Sendable {
    var imapHost = ""
    var imapPort = "993"
    var imapSecure = true
    var smtpHost = ""
    var smtpPort = "465"
    var smtpSecure = true
    var username = ""

    init() {}

    init(_ server: ServerConfig) {
        imapHost = server.imapHost
        imapPort = String(server.imapPort)
        imapSecure = server.imapSecure
        smtpHost = server.smtpHost
        smtpPort = String(server.smtpPort)
        smtpSecure = server.smtpSecure
        username = server.username
    }

    /// Blank servers for an address nothing could be detected for; the username starts as the address.
    static func blank(email: String) -> ServerForm {
        var form = ServerForm()
        form.username = email
        return form
    }

    var config: ServerConfig? {
        guard let imap = Self.port(imapPort), let smtp = Self.port(smtpPort) else { return nil }
        let imapName = imapHost.trimmingCharacters(in: .whitespaces)
        let smtpName = smtpHost.trimmingCharacters(in: .whitespaces)
        let user = username.trimmingCharacters(in: .whitespaces)
        guard !imapName.isEmpty, !smtpName.isEmpty, !user.isEmpty else { return nil }
        return ServerConfig(imapHost: imapName, imapPort: imap, imapSecure: imapSecure, smtpHost: smtpName, smtpPort: smtp, smtpSecure: smtpSecure, username: user)
    }

    private static func port(_ text: String) -> Int? {
        guard let value = Int(text.trimmingCharacters(in: .whitespaces)), (1...65535).contains(value) else { return nil }
        return value
    }
}

enum EmailAddress {
    /// `name@domain.tld` with no spaces. The service does the real check; this only decides when to start looking up servers.
    static func isPlausible(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = trimmed.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, !trimmed.contains(" ") else { return false }
        let domain = parts[1].split(separator: ".", omittingEmptySubsequences: false)
        return domain.count >= 2 && domain.allSatisfy { !$0.isEmpty }
    }

    static func isGoogleAddress(_ text: String) -> Bool {
        let domain = text.split(separator: "@").last.map { $0.lowercased() } ?? ""
        return domain == "gmail.com" || domain == "googlemail.com"
    }

    /// A display name when the person leaves the name blank: the part before the @.
    static func fallbackName(_ text: String) -> String {
        String(text.trimmingCharacters(in: .whitespaces).split(separator: "@").first ?? "")
    }
}

// Known mail providers (track 2C). Port of the table in packages/core/src/mail/autoconfig.ts; the shared
// `providers.json` fixture keeps both tables identical.

import FlintModel
import Foundation

struct ProviderPreset: Sendable {
    let imapHost: String
    let imapPort: Int
    let imapSecure: Bool
    let smtpHost: String
    let smtpPort: Int
    let smtpSecure: Bool
    let provider: MailProvider
    let oauthGoogle: Bool
    let hint: ServerHint?

    init(_ imapHost: String, _ imapPort: Int, _ imapSecure: Bool, _ smtpHost: String, _ smtpPort: Int, _ smtpSecure: Bool,
         provider: MailProvider = .imap, oauthGoogle: Bool = false, hint: ServerHint? = nil) {
        self.imapHost = imapHost
        self.imapPort = imapPort
        self.imapSecure = imapSecure
        self.smtpHost = smtpHost
        self.smtpPort = smtpPort
        self.smtpSecure = smtpSecure
        self.provider = provider
        self.oauthGoogle = oauthGoogle
        self.hint = hint
    }

    func server(username: String) -> ServerConfig {
        ServerConfig(imapHost: imapHost, imapPort: imapPort, imapSecure: imapSecure, smtpHost: smtpHost, smtpPort: smtpPort, smtpSecure: smtpSecure, username: username)
    }

    func autoconfig(username: String, source: AutoconfigSource) -> Autoconfig {
        Autoconfig(server: server(username: username), hint: hint, provider: provider, source: source, oauthGoogle: oauthGoogle)
    }
}

enum ProviderPresets {
    static let gmail = ProviderPreset("imap.gmail.com", 993, true, "smtp.gmail.com", 465, true, provider: .gmail, oauthGoogle: true, hint: .appPassword)
    static let outlook = ProviderPreset("outlook.office365.com", 993, true, "smtp.office365.com", 587, false)
    static let yahoo = ProviderPreset("imap.mail.yahoo.com", 993, true, "smtp.mail.yahoo.com", 465, true, hint: .appPassword)
    static let icloud = ProviderPreset("imap.mail.me.com", 993, true, "smtp.mail.me.com", 587, false, hint: .appPassword)
    static let fastmail = ProviderPreset("imap.fastmail.com", 993, true, "smtp.fastmail.com", 465, true)
    static let zoho = ProviderPreset("imap.zoho.com", 993, true, "smtp.zoho.com", 465, true)
    /// Proton Mail has no public IMAP; Proton Mail Bridge on a computer serves it on loopback. Not usable on a phone.
    static let proton = ProviderPreset("127.0.0.1", 1143, false, "127.0.0.1", 1025, true, hint: .protonBridge)
    static let aol = ProviderPreset("imap.aol.com", 993, true, "smtp.aol.com", 465, true, hint: .appPassword)

    static let known: [String: ProviderPreset] = [
        "gmail.com": gmail, "googlemail.com": gmail,
        "outlook.com": outlook, "hotmail.com": outlook, "live.com": outlook, "msn.com": outlook, "outlook.co.uk": outlook, "hotmail.co.uk": outlook,
        "yahoo.com": yahoo, "ymail.com": yahoo, "yahoo.co.uk": yahoo,
        "icloud.com": icloud, "me.com": icloud, "mac.com": icloud,
        "fastmail.com": fastmail, "fastmail.fm": fastmail, "messagingengine.com": fastmail,
        "zoho.com": zoho, "zohomail.com": zoho,
        "proton.me": proton, "protonmail.com": proton, "pm.me": proton, "protonmail.ch": proton,
        "aol.com": aol,
    ]

    static func byMX(_ host: MXHost) -> ProviderPreset {
        switch host {
        case .google: return gmail
        case .proton: return proton
        case .microsoft: return outlook
        case .fastmail: return fastmail
        case .zoho: return zoho
        case .icloud: return icloud
        }
    }
}

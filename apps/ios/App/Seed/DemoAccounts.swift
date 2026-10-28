import FlintMail
import FlintModel
import Foundation

/// The three fictional accounts and where their mail lives on the in-memory servers.
struct DemoAccount: Sendable {
    let id: AccountID
    let address: Address
    let provider: MailProvider
    let authKind: AuthKind
    let server: ServerConfig
    /// A Google account speaks X-GM-EXT-1: all mail in All Mail with labels.
    let isGmail: Bool

    var capabilities: TransportCapabilities {
        TransportCapabilities(idle: true, move: true, uidPlus: true, condstore: true, qresync: false, gmail: isGmail)
    }

    var folders: [RemoteFolder] {
        if isGmail {
            return [
                RemoteFolder(path: "INBOX", delimiter: "/"),
                RemoteFolder(path: "[Gmail]/All Mail", delimiter: "/", attributes: ["all"]),
                RemoteFolder(path: "[Gmail]/Drafts", delimiter: "/", attributes: ["drafts"]),
                RemoteFolder(path: "[Gmail]/Sent Mail", delimiter: "/", attributes: ["sent"]),
                RemoteFolder(path: "[Gmail]/Spam", delimiter: "/", attributes: ["junk"]),
                RemoteFolder(path: "[Gmail]/Trash", delimiter: "/", attributes: ["trash"]),
            ]
        }
        return [
            RemoteFolder(path: "INBOX", delimiter: "/"),
            RemoteFolder(path: "Sent", delimiter: "/", attributes: ["sent"]),
            RemoteFolder(path: "Drafts", delimiter: "/", attributes: ["drafts"]),
            RemoteFolder(path: "Archive", delimiter: "/", attributes: ["archive"]),
            RemoteFolder(path: "Trash", delimiter: "/", attributes: ["trash"]),
            RemoteFolder(path: "Junk", delimiter: "/", attributes: ["junk"]),
        ]
    }

    private static func server(imap: String, smtp: String, user: String, secure: Bool = true) -> ServerConfig {
        ServerConfig(imapHost: imap, imapPort: 993, imapSecure: secure, smtpHost: smtp, smtpPort: 465, smtpSecure: secure, username: user)
    }

    static let google = DemoAccount(
        id: "demo-google", address: DemoPeople.mayaGoogle, provider: .gmail, authKind: .oauthGoogle,
        server: server(imap: "imap.gmail.com", smtp: "smtp.gmail.com", user: DemoPeople.mayaGoogle.address), isGmail: true)
    static let work = DemoAccount(
        id: "demo-work", address: DemoPeople.mayaWork, provider: .imap, authKind: .password,
        server: server(imap: "imap.northwind.example", smtp: "smtp.northwind.example", user: DemoPeople.mayaWork.address), isGmail: false)
    static let personal = DemoAccount(
        id: "demo-personal", address: DemoPeople.mayaPersonal, provider: .imap, authKind: .password,
        server: server(imap: "imap.mayaokafor.example", smtp: "smtp.mayaokafor.example", user: DemoPeople.mayaPersonal.address), isGmail: false)

    static let all = [google, work, personal]
}

/// Puts `SeedMessage`s on an in-memory server in the layout the account's provider uses.
enum DemoDelivery {
    /// `batch` keeps Gmail message ids unique across calls for the same account.
    static func deliver(_ messages: [SeedMessage], to account: DemoAccount, server: FakeMailTransport, now: Date, batch: Int = 0) async {
        var counter = Int(account.id.utf8.reduce(0) { ($0 &* 31) &+ Int($1) } & 0xFFFF) * 1000 + batch * 500
        for message in messages.sorted(by: { $0.minutesAgo > $1.minutesAgo }) {
            counter += 1
            let seen = message.box != .inbox || !message.unread
            let (path, labels) = location(of: message, in: account)
            let gmail = account.isGmail
                ? GmailAttributes(msgid: String(counter), thrid: "t-\(message.threadKey)", labels: labels) : nil
            let built = SeedMessageBuilder.build(message, now: now, seen: seen, gmail: gmail)
            await server.deliver(built.envelope, parts: built.parts, to: path)
        }
    }

    private static func location(of message: SeedMessage, in account: DemoAccount) -> (path: String, labels: [String]) {
        if account.isGmail {
            switch message.box {
            case .inbox: return ("[Gmail]/All Mail", ["\\Inbox"])
            case .sent: return ("[Gmail]/All Mail", ["\\Sent"])
            case .archive: return ("[Gmail]/All Mail", [])
            case .trash: return ("[Gmail]/Trash", ["\\Trash"])
            }
        }
        switch message.box {
        case .inbox: return ("INBOX", [])
        case .sent: return ("Sent", [])
        case .archive: return ("Archive", [])
        case .trash: return ("Trash", [])
        }
    }
}

// FROZEN CONTRACT (Wave 1, track 1B). Value types used by `MailTransport`.
// Only SwiftMailTransport (track 2B) may import SwiftMail; everything else speaks these types.

import FlintModel
import Foundation

public enum TLSMode: Hashable, Sendable {
    /// TLS from the first byte (IMAP 993, SMTP 465).
    case implicit
    /// Plain connect, then STARTTLS; fail if the server does not offer it.
    case startTLS
    /// STARTTLS when offered, otherwise stay plain. Loopback hosts only (local test servers).
    case startTLSIfAvailable
}

public struct ServerEndpoint: Hashable, Sendable {
    public var host: String
    public var port: Int
    public var tls: TLSMode
    /// Accept a self-signed certificate. Loopback hosts only (Proton Bridge, local test servers).
    public var trustSelfSigned: Bool

    public init(host: String, port: Int, tls: TLSMode, trustSelfSigned: Bool = false) {
        self.host = host
        self.port = port
        self.tls = tls
        self.trustSelfSigned = trustSelfSigned
    }

    public static func isLoopback(_ host: String) -> Bool {
        host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    /// The desktop rule (`imapOptions` / `smtpOptions` in connect.ts): secure means implicit TLS; a remote plain
    /// connection must upgrade; loopback hosts skip certificate checks and, outside Proton Bridge's ports, upgrade only
    /// when the server offers STARTTLS.
    public static func from(host: String, port: Int, secure: Bool, bridgePorts: Set<Int> = [1143, 1025]) -> ServerEndpoint {
        if secure { return ServerEndpoint(host: host, port: port, tls: .implicit, trustSelfSigned: isLoopback(host)) }
        guard isLoopback(host) else { return ServerEndpoint(host: host, port: port, tls: .startTLS) }
        return ServerEndpoint(host: host, port: port, tls: bridgePorts.contains(port) ? .startTLS : .startTLSIfAvailable, trustSelfSigned: true)
    }
}

/// What to log in with. Values are secrets: never log, never put in an error message.
public enum MailCredential: Sendable {
    case password(user: String, password: String)
    case xoauth2(user: String, accessToken: String)

    public var user: String {
        switch self {
        case .password(let user, _), .xoauth2(let user, _): return user
        }
    }
}

public struct MailTransportConfiguration: Sendable {
    public var imap: ServerEndpoint
    public var smtp: ServerEndpoint
    public var credential: MailCredential

    public init(imap: ServerEndpoint, smtp: ServerEndpoint, credential: MailCredential) {
        self.imap = imap
        self.smtp = smtp
        self.credential = credential
    }

    public init(server: ServerConfig, credential: MailCredential) {
        self.init(
            imap: .from(host: server.imapHost, port: server.imapPort, secure: server.imapSecure),
            smtp: .from(host: server.smtpHost, port: server.smtpPort, secure: server.smtpSecure),
            credential: credential)
    }
}

/// Server abilities that change how the sync engine behaves.
public struct TransportCapabilities: Hashable, Sendable {
    public var idle: Bool
    public var move: Bool
    public var uidPlus: Bool
    public var condstore: Bool
    public var qresync: Bool
    /// X-GM-EXT-1: Gmail message ids, thread ids and labels.
    public var gmail: Bool

    public init(idle: Bool = true, move: Bool = true, uidPlus: Bool = true, condstore: Bool = false, qresync: Bool = false, gmail: Bool = false) {
        self.idle = idle
        self.move = move
        self.uidPlus = uidPlus
        self.condstore = condstore
        self.qresync = qresync
        self.gmail = gmail
    }
}

public struct RemoteFolder: Hashable, Sendable {
    public var path: String
    public var name: String
    public var delimiter: String?
    /// LIST attributes lower-cased without the backslash: "noselect", "sent", "trash", "drafts", "junk", "archive", "all", ...
    public var attributes: Set<String>

    public init(path: String, name: String? = nil, delimiter: String? = nil, attributes: Set<String> = []) {
        self.path = path
        self.name = name ?? path.split(separator: Character(delimiter ?? "/")).last.map(String.init) ?? path
        self.delimiter = delimiter
        self.attributes = attributes
    }

    public var isSelectable: Bool { !attributes.contains("noselect") && !attributes.contains("nonexistent") }
}

/// IMAP flags exactly as the server spells them: "\\Seen", "\\Flagged", "\\Answered", "\\Draft", "\\Deleted", keywords.
public enum IMAPFlag {
    public static let seen = "\\Seen"
    public static let flagged = "\\Flagged"
    public static let answered = "\\Answered"
    public static let draft = "\\Draft"
    public static let deleted = "\\Deleted"
}

/// A set of message UIDs, as a list or a range (`to` nil means "*").
public enum UIDSet: Hashable, Sendable {
    case uids([Int])
    case range(from: Int, to: Int?)

    public var isEmpty: Bool {
        if case .uids(let list) = self { return list.isEmpty }
        return false
    }
}

public struct SelectedMailbox: Hashable, Sendable {
    public var path: String
    public var uidValidity: Int
    public var uidNext: Int
    public var exists: Int
    /// Nil when the server has no CONDSTORE (or the mailbox does not support mod-sequences).
    public var highestModseq: UInt64?
    public var readOnly: Bool

    public init(path: String, uidValidity: Int, uidNext: Int, exists: Int, highestModseq: UInt64? = nil, readOnly: Bool = false) {
        self.path = path
        self.uidValidity = uidValidity
        self.uidNext = uidNext
        self.exists = exists
        self.highestModseq = highestModseq
        self.readOnly = readOnly
    }
}

/// What the client remembers from the last sync, to select with QRESYNC.
public struct QResyncState: Hashable, Sendable {
    public var uidValidity: Int
    public var highestModseq: UInt64

    public init(uidValidity: Int, highestModseq: UInt64) {
        self.uidValidity = uidValidity
        self.highestModseq = highestModseq
    }
}

public struct FlagState: Hashable, Sendable {
    public var uid: Int
    public var flags: Set<String>
    /// Gmail only (X-GM-LABELS), in the server's spelling, system labels with a leading backslash.
    public var labels: [String]?
    public var modseq: UInt64?

    public init(uid: Int, flags: Set<String>, labels: [String]? = nil, modseq: UInt64? = nil) {
        self.uid = uid
        self.flags = flags
        self.labels = labels
        self.modseq = modseq
    }
}

public struct SelectResult: Hashable, Sendable {
    public var mailbox: SelectedMailbox
    /// QRESYNC only: UIDs expunged since the remembered modseq.
    public var vanishedUIDs: [Int]
    /// QRESYNC only: flag changes since the remembered modseq.
    public var changedFlags: [FlagState]
    /// True when the server honored the QRESYNC parameters, so `vanishedUIDs` and `changedFlags` are complete.
    public var resynced: Bool

    public init(mailbox: SelectedMailbox, vanishedUIDs: [Int] = [], changedFlags: [FlagState] = [], resynced: Bool = false) {
        self.mailbox = mailbox
        self.vanishedUIDs = vanishedUIDs
        self.changedFlags = changedFlags
        self.resynced = resynced
    }
}

public struct GmailAttributes: Hashable, Sendable {
    public var msgid: String
    public var thrid: String
    public var labels: [String]

    public init(msgid: String, thrid: String, labels: [String] = []) {
        self.msgid = msgid
        self.thrid = thrid
        self.labels = labels
    }
}

/// One node of a BODYSTRUCTURE tree. `number` is the IMAP part number ("1", "2.1"); the root of a single-part message is "1".
public struct BodyPart: Hashable, Sendable {
    public var number: String
    public var type: String
    public var subtype: String
    public var parameters: [String: String]
    public var contentId: String?
    public var disposition: String?
    public var filename: String?
    public var encoding: String?
    public var size: Int
    public var children: [BodyPart]

    public init(
        number: String, type: String, subtype: String, parameters: [String: String] = [:], contentId: String? = nil,
        disposition: String? = nil, filename: String? = nil, encoding: String? = nil, size: Int = 0, children: [BodyPart] = []
    ) {
        self.number = number
        self.type = type
        self.subtype = subtype
        self.parameters = parameters
        self.contentId = contentId
        self.disposition = disposition
        self.filename = filename
        self.encoding = encoding
        self.size = size
        self.children = children
    }

    public var mediaType: String { "\(type)/\(subtype)".lowercased() }
}

public struct EnvelopeFetchOptions: Hashable, Sendable {
    public var bodyStructure: Bool
    /// Header names to return (lower-cased in the result), for example `FETCH_HEADERS` of the desktop engine.
    public var headers: [String]
    /// Ask for X-GM-MSGID, X-GM-THRID and X-GM-LABELS. Ignored when the server has no Gmail extension.
    public var gmail: Bool

    public init(bodyStructure: Bool = true, headers: [String] = [], gmail: Bool = false) {
        self.bodyStructure = bodyStructure
        self.headers = headers
        self.gmail = gmail
    }
}

public struct RemoteEnvelope: Hashable, Sendable {
    public var uid: Int
    public var flags: Set<String>
    public var internalDate: Date?
    public var size: Int
    public var messageId: String?
    public var inReplyTo: String?
    public var subject: String
    public var date: Date?
    public var from: [Address]
    public var to: [Address]
    public var cc: [Address]
    public var bcc: [Address]
    public var replyTo: [Address]
    /// Requested headers, lower-cased names, first value wins.
    public var headers: [String: String]
    public var bodyStructure: BodyPart?
    public var gmail: GmailAttributes?
    public var modseq: UInt64?

    public init(
        uid: Int, flags: Set<String> = [], internalDate: Date? = nil, size: Int = 0, messageId: String? = nil, inReplyTo: String? = nil,
        subject: String = "", date: Date? = nil, from: [Address] = [], to: [Address] = [], cc: [Address] = [], bcc: [Address] = [],
        replyTo: [Address] = [], headers: [String: String] = [:], bodyStructure: BodyPart? = nil, gmail: GmailAttributes? = nil,
        modseq: UInt64? = nil
    ) {
        self.uid = uid
        self.flags = flags
        self.internalDate = internalDate
        self.size = size
        self.messageId = messageId
        self.inReplyTo = inReplyTo
        self.subject = subject
        self.date = date
        self.from = from
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.replyTo = replyTo
        self.headers = headers
        self.bodyStructure = bodyStructure
        self.gmail = gmail
        self.modseq = modseq
    }
}

public enum FlagMode: Hashable, Sendable {
    case add, remove, replace
}

public indirect enum SearchCriteria: Hashable, Sendable {
    case all
    case since(Date)
    case before(Date)
    case uid(UIDSet)
    case seen
    case unseen
    case flagged
    case header(name: String, value: String)
    case text(String)
    /// Gmail X-GM-RAW search string, passed through (searchServer).
    case gmailRaw(String)
    case and([SearchCriteria])
    case not(SearchCriteria)
}

public enum IdleEvent: Hashable, Sendable {
    /// EXISTS: the mailbox now holds this many messages.
    case newMessages(exists: Int)
    case expunged
    case flagsChanged
    /// The connection ended; the stream finishes after this. Callers reconnect with backoff.
    case disconnected(reason: String?)
}

/// A complete message to hand to SMTP. `raw` is the whole RFC 5322 text (headers and body); the envelope is separate
/// so tracked sends can send byte-identical copies that differ only in recipient.
public struct OutgoingMessage: Sendable {
    public var envelopeFrom: String
    public var recipients: [String]
    public var raw: Data

    public init(envelopeFrom: String, recipients: [String], raw: Data) {
        self.envelopeFrom = envelopeFrom
        self.recipients = recipients
        self.raw = raw
    }
}

/// Creates a fresh, unconnected transport. The account session keeps one for commands and one for IDLE.
public typealias MailTransportFactory = @Sendable () -> any MailTransport

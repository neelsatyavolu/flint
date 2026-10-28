// The production MailTransport: IMAP and SMTP through SwiftMail (Cocoanetics/SwiftMail, BSD-2-Clause). This is the only file
// in the app that imports SwiftMail, so the library can be swapped or patched without touching the sync engine.
//
// Behavior the engine relies on, and where SwiftMail differs from the desktop's imapflow:
//   - SwiftMail cannot send `FETCH ... (CHANGEDSINCE n)`, so `fetchFlags(changedSince:)` asks `UID SEARCH MODSEQ n+1` for the
//     changed UIDs and fetches only those. That is what keeps Gmail (CONDSTORE, no QRESYNC) from re-reading every flag and
//     label each cycle. QRESYNC works through `selectMailbox(resyncingFrom:)`, so servers that have it (iCloud, Dovecot,
//     Fastmail) report flag changes on SELECT.
//   - `capabilities.gmail` is true when X-GM-EXT-1 is advertised. SwiftMail has no X-GM-LABELS store and no X-GM-RAW
//     search, so label edits are MOVE/COPY (see ServerActions) and `.gmailRaw` is refused.
//   - `fetchPart` returns the part with its transfer encoding removed. SwiftMail returns the raw bytes, so the encoding
//     learned from BODYSTRUCTURE is remembered per message and applied here.
//   - Extra headers are requested with BODY[HEADER.FIELDS]. A server that answers without them (GreenMail leaves out the closing
//     blank line, which SwiftMail's header parser needs) is asked for the whole header once, remembered per connection.
//   - An SMTP send opens its own connection (connect, authenticate, send, disconnect) so it never blocks IMAP commands.
//   - A send that fails after the message body was handed over without a clear answer is reported as `.conflict` ("may have
//     been accepted") so callers do not retry it into a duplicate.
//
// Credentials and message content are never put in an error message or logged by this file. SwiftMail itself logs through
// swift-log at info level (host, port, command names); the app target installs a privacy-safe LogHandler.

import FlintModel
import Foundation
import SwiftMail

public actor SwiftMailTransport: MailTransport {
    private var imap: IMAPServer?
    private var configuration: MailTransportConfiguration?
    private var caps = TransportCapabilities()
    private var qresyncEnabled = false
    /// Set once a server ignored `BODY[HEADER.FIELDS]` (GreenMail omits the closing blank line, which SwiftMail's parser needs).
    private var fullHeaderFallback = false
    private var selectedPath: String?
    private var encodings: [String: [String: String]] = [:]
    private let tokenBox = TokenBox()

    private static let encodingCacheLimit = 2000
    /// A SEARCH over a big mailbox answers with every UID on one line; the library default (1 MB) fits about 140k of them.
    private static let responseBufferLimit = 8 * 1024 * 1024

    public init() {}

    /// A factory for `AccountSession`: every call makes a fresh, unconnected transport.
    public static let factory: MailTransportFactory = { SwiftMailTransport() }

    // MARK: Connection

    public func connect(_ configuration: MailTransportConfiguration) async throws {
        await disconnect()
        self.configuration = configuration
        let endpoint = configuration.imap
        let server = IMAPServer(
            host: endpoint.host, port: endpoint.port, transportSecurity: Self.security(endpoint.tls),
            certificateVerificationPolicy: endpoint.trustSelfSigned ? .noVerification : .fullVerification, responseBufferLimit: Self.responseBufferLimit)
        do {
            try await server.connect()
            switch configuration.credential {
            case .password(let user, let password):
                try await server.login(username: user, password: password)
            case .xoauth2(let user, let accessToken):
                tokenBox.set(accessToken)
                try await server.authenticateXOAUTH2(email: user, accessToken: accessToken)
                let box = tokenBox
                await server.setXOAUTH2AccessTokenProvider(email: user, accessTokenProvider: { box.get() })
            }
            caps = try await Self.detectCapabilities(server)
            qresyncEnabled = false
            fullHeaderFallback = false
            if caps.qresync { qresyncEnabled = (try? await server.enable([.qresync])) != nil }
            caps.qresync = qresyncEnabled
        } catch {
            try? await server.disconnect()
            throw Self.map(error, host: endpoint.host)
        }
        imap = server
    }

    public func updateCredential(_ credential: MailCredential) async {
        configuration?.credential = credential
        if case .xoauth2(_, let token) = credential { tokenBox.set(token) }
    }

    public func disconnect() async {
        let old = imap
        imap = nil
        selectedPath = nil
        encodings = [:]
        if let old { try? await old.disconnect() }
    }

    public var isConnected: Bool {
        get async {
            guard let imap else { return false }
            return await imap.isConnected
        }
    }

    public var capabilities: TransportCapabilities { caps }

    public func verifySend() async throws {
        let smtp = try await openSMTP()
        try? await smtp.disconnect()
    }

    private func server() throws -> IMAPServer {
        guard let imap else { throw FlintError(.network, "Not connected to the IMAP server.") }
        return imap
    }

    private static func security(_ mode: TLSMode) -> MailTransportSecurity {
        switch mode {
        case .implicit: return .implicitTLS
        case .startTLS: return .startTLS
        // Loopback test servers only (the endpoint rules guarantee it): upgrade is not negotiated, so stay plain.
        case .startTLSIfAvailable: return .plainText
        }
    }

    private static func detectCapabilities(_ server: IMAPServer) async throws -> TransportCapabilities {
        let names = Set(try await server.fetchCapabilities().map { $0.name.uppercased() })
        func has(_ name: String) -> Bool { names.contains(name) }
        return TransportCapabilities(
            idle: has("IDLE"), move: await server.supportsMove, uidPlus: await server.supportsUIDPlus,
            condstore: has("CONDSTORE"), qresync: has("QRESYNC") && has("ENABLE"), gmail: await server.supportsGmailExtensions)
    }

    // MARK: Folders

    public func listFolders() async throws -> [RemoteFolder] {
        let server = try server()
        do {
            return try await server.listMailboxes().map { info in
                RemoteFolder(path: info.name, delimiter: info.hierarchyDelimiter, attributes: Self.attributeNames(info.attributes))
            }
        } catch { throw Self.map(error) }
    }

    private static func attributeNames(_ attributes: Mailbox.Info.Attributes) -> Set<String> {
        let table: [(Mailbox.Info.Attributes, String)] = [
            (.noSelect, "noselect"), (.archive, "archive"), (.drafts, "drafts"), (.flagged, "flagged"), (.junk, "junk"), (.sent, "sent"),
            (.trash, "trash"), (.inbox, "inbox"), (.all, "all"), (.important, "important"),
        ]
        return Set(table.filter { attributes.contains($0.0) }.map(\.1))
    }

    public func createFolder(_ path: String) async throws {
        do { try await server().createMailbox(path) } catch { throw Self.map(error) }
    }

    public func select(_ path: String, readOnly: Bool, qresync: QResyncState?) async throws -> SelectResult {
        let server = try server()
        do {
            if let state = qresync, qresyncEnabled, state.highestModseq <= UInt64(Int64.max), state.uidValidity >= 0 {
                let result = try await server.selectMailbox(path, resyncingFrom: UIDValidity(state.uidValidity), modificationSequence: .init(state.highestModseq))
                selectedPath = path
                let mailbox = Self.mailbox(result.selection, path: path, readOnly: false)
                let honored = mailbox.uidValidity == state.uidValidity
                guard honored else { return SelectResult(mailbox: mailbox) }
                let gone = result.vanishedEarlier.toArray() + result.vanished.toArray()
                let changed = result.changedFlags.map { FlagState(uid: Int($0.key.value), flags: Set(Self.flagStrings($0.value))) }.sorted { $0.uid < $1.uid }
                return SelectResult(mailbox: mailbox, vanishedUIDs: gone.map { Int($0.value) }.sorted(), changedFlags: changed, resynced: true)
            }
            let selection = readOnly ? try await server.examineMailbox(path) : try await server.selectMailbox(path)
            selectedPath = path
            return SelectResult(mailbox: Self.mailbox(selection, path: path, readOnly: readOnly))
        } catch { throw Self.map(error, mailbox: path) }
    }

    private static func mailbox(_ selection: Mailbox.Selection, path: String, readOnly: Bool) -> SelectedMailbox {
        SelectedMailbox(
            path: path, uidValidity: Int(selection.uidValidity.value), uidNext: Int(selection.uidNext.value), exists: selection.messageCount,
            highestModseq: selection.highestModSequence.flatMap { UInt64(String(reflecting: $0)) }, readOnly: readOnly || selection.isReadOnly)
    }

    // MARK: Reading

    private static func uidSet(_ set: UIDSet) -> SwiftMail.UIDSet {
        switch set {
        case .uids(let list): return SwiftMail.UIDSet(list.map { UID($0) })
        case .range(let from, let to):
            if let to { return SwiftMail.UIDSet(UID(from)...UID(max(from, to))) }
            return SwiftMail.UIDSet(UID(from)...)
        }
    }

    public func search(_ criteria: SearchCriteria) async throws -> [Int] {
        let server = try server()
        var restrictTo: SwiftMail.UIDSet?
        let mapped = try Self.mapCriteria(criteria, restrict: &restrictTo)
        do {
            let result = try await server.extendedSearch(identifierSet: restrictTo, criteria: mapped.isEmpty ? [.all] : mapped) as ExtendedSearchResult<UID>
            let uids = result.ordered ?? result.all?.toArray() ?? []
            return uids.map { Int($0.value) }.sorted()
        } catch { throw Self.map(error) }
    }

    private static func mapCriteria(_ criteria: SearchCriteria, restrict: inout SwiftMail.UIDSet?) throws -> [SwiftMail.SearchCriteria] {
        switch criteria {
        case .all: return []
        case .since(let date): return [.since(date)]
        case .before(let date): return [.before(date)]
        case .uid(let set):
            restrict = uidSet(set)
            return []
        case .seen: return [.seen]
        case .unseen: return [.unseen]
        case .flagged: return [.flagged]
        case .header(let name, let value): return [.header(name, value)]
        case .text(let text): return [.text(text)]
        case .gmailRaw: throw FlintError(.invalid, "Gmail search syntax isn't available on this connection.")
        case .and(let list): return try list.flatMap { try mapCriteria($0, restrict: &restrict) }
        case .not(let inner):
            var ignored: SwiftMail.UIDSet?
            let mapped = try mapCriteria(inner, restrict: &ignored)
            guard ignored == nil else { throw FlintError(.invalid, "A UID range can't be negated.") }
            return mapped.count == 1 ? [.not(mapped[0])] : [.not(.and(mapped))]
        }
    }

    /// SwiftMail's chunked stream expands the set into every identifier, which for an open range ("N:*") is four billion of them.
    /// A list or a short range is fetched in chunks of 50; anything open or long goes out as one FETCH.
    private static func fetchInfos(
        _ server: IMAPServer, _ uids: UIDSet, _ set: SwiftMail.UIDSet, options: FetchMessageInfoOptions, headerFields: [String]?
    ) async throws -> [MessageInfo] {
        let chunkable: Bool
        switch uids {
        case .uids: chunkable = true
        case .range(let from, let to): chunkable = to.map { $0 - from < 5000 } ?? false
        }
        guard chunkable else { return try await server.fetchMessageInfosBulk(using: set, options: options, headerFields: headerFields) }
        var infos: [MessageInfo] = []
        for try await info in server.fetchMessageInfos(using: set, options: options, headerFields: headerFields, chunkSize: 50) { infos.append(info) }
        return infos
    }

    public func fetchEnvelopes(_ uids: UIDSet, options: EnvelopeFetchOptions) async throws -> [RemoteEnvelope] {
        let server = try server()
        let set = Self.uidSet(uids)
        guard !set.isEmpty else { return [] }
        var fetch: FetchMessageInfoOptions = [.envelope, .internalDate, .flags, .size]
        if options.bodyStructure { fetch.insert(.bodyStructure) }
        let wanted = Set(options.headers.map { $0.lowercased() })
        do {
            var infos = try await Self.fetchInfos(
                server, uids, set, options: fetchWithHeaders(fetch, wanted: wanted), headerFields: wanted.isEmpty || fullHeaderFallback ? nil : options.headers)
            // A server that ignores HEADER.FIELDS answers with no extra headers for every message. Ask for the whole header once
            // and remember, instead of silently losing the signals the categorizer reads.
            if !wanted.isEmpty, !fullHeaderFallback, !infos.isEmpty, infos.allSatisfy({ $0.additionalFields == nil }) {
                fullHeaderFallback = true
                infos = try await Self.fetchInfos(server, uids, set, options: fetchWithHeaders(fetch, wanted: wanted), headerFields: nil)
            }
            var gmail: [UID: GmailMessageAttributes] = [:]
            if options.gmail && caps.gmail { gmail = try await server.fetchGmailAttributes(for: set) }
            return infos.compactMap { info in
                guard let uid = info.uid else { return nil }
                let tree = options.bodyStructure ? BodyPartTree.build(info.parts.map(Self.descriptor)) : nil
                if options.bodyStructure { remember(uid: Int(uid.value), parts: info.parts) }
                return Self.envelope(info, uid: uid, tree: tree, gmail: gmail[uid], wanted: wanted)
            }
        } catch { throw Self.map(error) }
    }

    private func fetchWithHeaders(_ base: FetchMessageInfoOptions, wanted: Set<String>) -> FetchMessageInfoOptions {
        var options = base
        if !wanted.isEmpty && fullHeaderFallback { options.insert(.fullHeader) }
        return options
    }

    private static func envelope(_ info: MessageInfo, uid: UID, tree: BodyPart?, gmail: GmailMessageAttributes?, wanted: Set<String>) -> RemoteEnvelope {
        func addresses(_ entries: [AddressListEntry]) -> [Address] {
            entries.mailboxes.map { Address(name: $0.name ?? "", address: $0.address) }
        }
        var headers: [String: String] = [:]
        for field in info.additionalHeaderFields ?? [] where headers[field.name.lowercased()] == nil { headers[field.name.lowercased()] = field.value }
        if headers.isEmpty { for (name, value) in info.additionalFields ?? [:] { headers[name.lowercased()] = value } }
        // SwiftMail parses References into `references` and keeps it out of the extra headers.
        if let references = info.references, !references.isEmpty { headers["references"] = references.map(\.description).joined(separator: " ") }
        headers = headers.filter { wanted.contains($0.key) }
        return RemoteEnvelope(
            uid: Int(uid.value), flags: Set(flagStrings(info.flags)), internalDate: info.internalDate, size: info.size ?? 0,
            messageId: info.messageId.map(\.description), inReplyTo: info.inReplyTo.map(\.description), subject: info.subject ?? "", date: info.date,
            from: addresses(info.fromAddresses), to: addresses(info.toAddresses), cc: addresses(info.ccAddresses), bcc: addresses(info.bccAddresses),
            replyTo: addresses(info.replyToAddresses), headers: headers, bodyStructure: tree,
            gmail: gmail.map { GmailAttributes(msgid: String($0.messageID), thrid: String($0.threadID), labels: $0.labels) })
    }

    public func fetchFlags(_ uids: UIDSet, includeLabels: Bool, changedSince: UInt64?) async throws -> [FlagState] {
        let server = try server()
        do {
            var target = uids
            if let changedSince {
                let changed = try await Self.changedUIDs(server, in: uids, since: changedSince)
                guard !changed.isEmpty else { return [] }
                target = .uids(changed)
            }
            let set = Self.uidSet(target)
            guard !set.isEmpty else { return [] }
            var states: [FlagState] = []
            for info in try await Self.fetchInfos(server, target, set, options: .uidFlagsOnly, headerFields: nil) {
                guard let uid = info.uid else { continue }
                states.append(FlagState(uid: Int(uid.value), flags: Set(Self.flagStrings(info.flags))))
            }
            guard includeLabels && caps.gmail else { return states }
            let labels = try await server.fetchGmailAttributes(for: set)
            return states.map { state in
                var copy = state
                copy.labels = labels[UID(state.uid)]?.labels
                return copy
            }
        } catch { throw Self.map(error) }
    }

    /// UIDs in `uids` whose mod-sequence is above `modseq` (RFC 7162 `SEARCH MODSEQ`), standing in for `CHANGEDSINCE`.
    private static func changedUIDs(_ server: IMAPServer, in uids: UIDSet, since modseq: UInt64) async throws -> [Int] {
        guard modseq < UInt64(Int64.max) else { return [] }
        let criteria: SwiftMail.SearchCriteria = .modSeq(.init(extensions: [:], sequenceValue: .init(modseq + 1)))
        let result = try await server.extendedSearch(identifierSet: uidSet(uids), criteria: [criteria]) as ExtendedSearchResult<UID>
        let found = result.ordered ?? result.all?.toArray() ?? []
        return found.map { Int($0.value) }.sorted()
    }

    public func fetchBodyStructure(uid: Int) async throws -> BodyPart? {
        let server = try server()
        do {
            let parts = try await server.fetchStructure(UID(uid))
            remember(uid: uid, parts: parts)
            return BodyPartTree.build(parts.map(Self.descriptor))
        } catch { throw Self.map(error) }
    }

    public func fetchPart(uid: Int, part: String) async throws -> Data {
        let server = try server()
        do {
            let raw = try await server.fetchPart(section: Section(part), of: UID(uid))
            var encoding = knownEncoding(uid: uid, part: part)
            if encoding == nil {
                let parts = try await server.fetchStructure(UID(uid))
                remember(uid: uid, parts: parts)
                encoding = knownEncoding(uid: uid, part: part)
            }
            return raw.decoded(for: MessagePart(sectionString: part, contentType: "application/octet-stream", encoding: encoding))
        } catch { throw Self.map(error) }
    }

    public func fetchRawMessage(uid: Int) async throws -> Data {
        do { return try await server().fetchRawMessage(identifier: UID(uid)) } catch { throw Self.map(error) }
    }

    // MARK: Writing

    public func storeFlags(_ uids: UIDSet, flags: [String], mode: FlagMode) async throws {
        let server = try server()
        let set = Self.uidSet(uids)
        guard !set.isEmpty else { return }
        let operation: StoreData.StoreType = mode == .add ? .add : mode == .remove ? .remove : .replace
        do { try await server.store(flags: flags.map(Self.flag), on: set, operation: operation) } catch { throw Self.map(error) }
    }

    public func move(_ uids: UIDSet, to path: String) async throws -> [Int: Int] {
        let server = try server()
        let set = Self.uidSet(uids)
        guard !set.isEmpty else { return [:] }
        do { return Self.mapping(try await server.move(messages: set, to: path)) } catch { throw Self.map(error, mailbox: path) }
    }

    public func copy(_ uids: UIDSet, to path: String) async throws -> [Int: Int] {
        let server = try server()
        let set = Self.uidSet(uids)
        guard !set.isEmpty else { return [:] }
        do { return Self.mapping(try await server.copy(messages: set, to: path)) } catch { throw Self.map(error, mailbox: path) }
    }

    private static func mapping(_ copyUID: CopyUID?) -> [Int: Int] {
        guard let copyUID else { return [:] }
        return Dictionary(copyUID.mapping.map { (Int($0.source.value), Int($0.destination.value)) }, uniquingKeysWith: { first, _ in first })
    }

    public func expunge(_ uids: UIDSet) async throws {
        let server = try server()
        let set = Self.uidSet(uids)
        guard !set.isEmpty else { return }
        do {
            try await server.store(flags: [.deleted], on: set, operation: .add)
            if caps.uidPlus { try await server.expunge(messages: set) } else { try await server.expunge() }
        } catch { throw Self.map(error) }
    }

    public func append(_ raw: Data, to path: String, flags: [String], date: Date?) async throws -> Int? {
        let server = try server()
        do {
            // The message builder emits 7-bit text, so the UTF-8 view is exact.
            let result = try await server.append(rawMessage: String(decoding: raw, as: UTF8.self), to: path, flags: flags.map(Self.flag), internalDate: date)
            return result.firstUID.map { Int($0.value) }
        } catch { throw Self.map(error, mailbox: path) }
    }

    // MARK: Push

    public func idle(mailbox: String) async -> AsyncStream<IdleEvent> {
        guard let server = imap else { return Self.endedStream("Not connected.") }
        let reconnects = IdleReconnectBus.stream() // before the session, so a fast redial cannot slip past
        let session: IMAPIdleSession
        do { session = try await server.idle(on: mailbox) } catch { return Self.endedStream(Self.map(error).message) }
        return AsyncStream { continuation in
            let pump = Task {
                for await event in session.events {
                    switch event {
                    case .exists(let count): continuation.yield(.newMessages(exists: count))
                    case .expunge, .vanished: continuation.yield(.expunged)
                    case .fetch, .fetchUID, .flags: continuation.yield(.flagsChanged)
                    case .bye(let reason):
                        continuation.yield(.disconnected(reason: reason))
                        continuation.finish()
                        return
                    default: break
                    }
                }
                continuation.yield(.disconnected(reason: nil))
                continuation.finish()
            }
            let reconnectPump = Task {
                for await _ in reconnects { continuation.yield(.reconnected) }
            }
            continuation.onTermination = { _ in
                pump.cancel()
                reconnectPump.cancel()
                Task { try? await session.done() }
            }
        }
    }

    private static func endedStream(_ reason: String) -> AsyncStream<IdleEvent> {
        AsyncStream { continuation in
            continuation.yield(.disconnected(reason: reason))
            continuation.finish()
        }
    }

    // MARK: Sending

    private func openSMTP() async throws -> SMTPServer {
        guard let configuration else { throw FlintError(.network, "Not connected.") }
        let endpoint = configuration.smtp
        let smtp = SMTPServer(
            host: endpoint.host, port: endpoint.port, transportSecurity: Self.security(endpoint.tls),
            certificateVerificationPolicy: endpoint.trustSelfSigned ? .noVerification : .fullVerification)
        do {
            try await smtp.connect()
            switch configuration.credential {
            case .password(let user, let password): try await smtp.login(username: user, password: password)
            case .xoauth2(let user, let token): try await smtp.authenticateXOAUTH2(email: user, accessToken: token)
            }
        } catch {
            try? await smtp.disconnect()
            throw Self.map(error, host: endpoint.host)
        }
        return smtp
    }

    public func send(_ message: OutgoingMessage) async throws {
        guard !message.recipients.isEmpty else { throw FlintError(.invalid, "Add at least one recipient.") }
        let smtp = try await openSMTP()
        do {
            try await smtp.sendRawMessage(message.raw, from: EmailAddress(address: message.envelopeFrom), to: message.recipients.map { EmailAddress(address: $0) })
        } catch {
            try? await smtp.disconnect()
            throw Self.map(error)
        }
        try? await smtp.disconnect()
    }

    // MARK: Part encodings

    private func remember(uid: Int, parts: [MessagePart]) {
        if encodings.count > Self.encodingCacheLimit { encodings = [:] }
        var table: [String: String] = [:]
        for part in parts { if let encoding = part.encoding { table[part.section.description] = encoding } }
        encodings["\(selectedPath ?? "")#\(uid)"] = table
    }

    private func knownEncoding(uid: Int, part: String) -> String? {
        guard let table = encodings["\(selectedPath ?? "")#\(uid)"] else { return nil }
        return table[part] ?? "7bit"
    }

    private static func descriptor(_ part: MessagePart) -> PartDescriptor {
        PartDescriptor(
            section: part.section.description, contentType: part.contentType, disposition: part.disposition, encoding: part.encoding,
            filename: part.filename, contentId: part.contentId, size: part.size ?? 0)
    }

    // MARK: Flags

    private static func flagStrings(_ flags: [Flag]) -> [String] {
        flags.map { flag in
            switch flag {
            case .seen: return IMAPFlag.seen
            case .answered: return IMAPFlag.answered
            case .flagged: return IMAPFlag.flagged
            case .deleted: return IMAPFlag.deleted
            case .draft: return IMAPFlag.draft
            case .custom(let name): return name
            }
        }
    }

    private static func flag(_ name: String) -> Flag {
        switch name.lowercased() {
        case "\\seen": return .seen
        case "\\answered": return .answered
        case "\\flagged": return .flagged
        case "\\deleted": return .deleted
        case "\\draft": return .draft
        default: return .custom(name)
        }
    }

    // MARK: Errors

    /// Short, user-facing text for a failure. Never includes credentials or message content.
    static func map(_ error: Error, host: String? = nil, mailbox: String? = nil) -> FlintError {
        if let flint = error as? FlintError { return flint }
        if error is CancellationError { return FlintError(.network, "The operation was cancelled.") }
        if let imap = error as? IMAPError { return map(imap, host: host, mailbox: mailbox) }
        if let smtp = error as? SMTPError { return map(smtp, host: host) }
        if let send = error as? SMTPSendError { return map(send) }
        let type = String(reflecting: type(of: error))
        if type.contains("SSL") || type.contains("TLS") {
            return FlintError(.network, "The server's security certificate was not accepted.")
        }
        return FlintError(.network, "Could not connect to the server. Check the host, port and encryption setting.")
    }

    private static let appPasswordHosts = try! NSRegularExpression(
        pattern: #"(^|\.)(gmail\.com|googlemail\.com|google\.com|me\.com|icloud\.com|yahoo\.com|aol\.com|office365\.com|outlook\.com)$"#, options: [.caseInsensitive])

    private static func authMessage(_ host: String?) -> String {
        var message = "The server rejected the username or password."
        guard let host else { return message }
        if ServerEndpoint.isLoopback(host) {
            message += " Use the password from Proton Mail Bridge, not your account password."
        } else if appPasswordHosts.firstMatch(in: host, range: NSRange(host.startIndex..., in: host)) != nil {
            message += " This provider needs an app password."
        }
        return message
    }

    private static func map(_ error: IMAPError, host: String?, mailbox: String?) -> FlintError {
        switch error {
        case .loginFailed, .authFailed, .unsupportedAuthMechanism: return FlintError(.auth, authMessage(host))
        case .connectionFailed, .greetingFailed, .timeout:
            return FlintError(.network, "Could not connect to the IMAP server. Check the host, port and encryption setting.")
        case .selectFailed: return FlintError(.notFound, mailbox.map { "The mailbox \"\($0)\" doesn't exist." } ?? "That mailbox doesn't exist.")
        case .emptyIdentifierSet, .invalidArgument, .commandNotSupported: return FlintError(.invalid, "The server doesn't support that request.")
        case .createFailed, .copyFailed, .moveFailed, .storeFailed, .expungeFailed, .searchCharsetNotSupported, .appendLimitExceeded:
            return FlintError(.invalid, "The server refused the change.")
        case .moveFailedAfterPossiblePartialCompletion:
            // A tagged NO with no COPYUID evidence: the server refused (most often a destination that does not exist yet).
            return FlintError(.invalid, "The server refused the change.")
        case .moveFailedAfterPartialCompletion, .moveFallbackFailedAfterCopy, .malformedCopyUIDAfterTaggedOK:
            return FlintError(.conflict, "The server may have moved the message. It will correct itself on the next sync.")
        case .fetchFailed, .commandFailed, .deleteFailed, .renameFailed, .logoutFailed:
            return FlintError(.network, "The IMAP server didn't answer as expected.")
        }
    }

    private static func map(_ error: SMTPError, host: String?) -> FlintError {
        switch error {
        case .authenticationFailed: return FlintError(.auth, authMessage(host))
        case .connectionFailed, .tlsFailed:
            return FlintError(.network, "Could not connect to the SMTP server. Check the host, port and encryption setting.")
        case .invalidEmailAddress: return FlintError(.invalid, "One of the addresses isn't valid.")
        case .messageTooLarge: return FlintError(.invalid, "The message is too large for this server.")
        case .invalidResponse, .sendFailed, .commandFailed, .unexpectedResponse: return FlintError(.network, "The SMTP server didn't answer as expected.")
        }
    }

    private static func map(_ error: SMTPSendError) -> FlintError {
        switch error.retryDisposition {
        case .unsafeToRetry:
            return FlintError(.conflict, "The server may have accepted this message. Check Sent before sending it again.")
        case .permanent:
            return FlintError(.invalid, "The server refused the message.")
        case .retryable:
            if case .reply(let response) = error.reason, response.code >= 500 { return FlintError(.invalid, "The server refused the message.") }
            return FlintError(.network, "The message couldn't be sent. Flint will try again.")
        }
    }
}

/// The OAuth access token a reconnecting IMAP connection logs in with. Lock-protected because SwiftMail reads it from its own tasks.
private final class TokenBox: @unchecked Sendable {
    private let lock = NSLock()
    private var token = ""
    func set(_ value: String) { lock.lock(); token = value; lock.unlock() }
    func get() -> String { lock.lock(); defer { lock.unlock() }; return token }
}

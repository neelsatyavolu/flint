// In-memory MailTransport for sync-engine and action tests (track 1B). It models the parts of IMAP the engine relies on:
// UID allocation per mailbox, UIDVALIDITY, flags, mod-sequences and QRESYNC (opt in via capabilities), the "N:*" range
// quirk, MOVE with UIDPLUS mapping, APPEND, search, IDLE events and SMTP capture. Failures are injected per method name.

import FlintModel
import Foundation

public actor FakeMailTransport: MailTransport {
    private struct Stored {
        var envelope: RemoteEnvelope
        var raw: Data
        var parts: [String: Data]
    }

    private struct Box {
        var attributes: Set<String>
        var delimiter: String?
        var uidValidity: Int
        var nextUID = 1
        var highestModseq: UInt64 = 1
        var messages: [Int: Stored] = [:]
        var expungeLog: [(uid: Int, modseq: UInt64)] = []
    }

    private var boxes: [String: Box] = [:]
    private var folderOrder: [String] = []
    private var selectedPath: String?
    private var connected = false
    /// `connect` calls minus `disconnect` calls. A session uses one instance for its command and IDLE connections in tests.
    private var openConnections = 0
    private var caps: TransportCapabilities
    private var failures: [String: FlintError] = [:]
    private var delayedFailures: [String: (skip: Int, error: FlintError)] = [:]
    private var idleListeners: [UUID: (mailbox: String, continuation: AsyncStream<IdleEvent>.Continuation)] = [:]
    private var rejectedLogins = false

    /// Every transport method called, in order, by name (for example "select", "storeFlags").
    public private(set) var calls: [String] = []
    /// Messages handed to `send`, in order.
    public private(set) var sentMessages: [OutgoingMessage] = []
    public private(set) var configuration: MailTransportConfiguration?
    public private(set) var connectCount = 0

    public init(capabilities: TransportCapabilities = TransportCapabilities(condstore: true), folders: [RemoteFolder] = [RemoteFolder(path: "INBOX", delimiter: "/")]) {
        caps = capabilities
        for folder in folders { Self.add(folder, uidValidity: 1000, to: &boxes, order: &folderOrder) }
    }

    private static func add(_ folder: RemoteFolder, uidValidity: Int, to boxes: inout [String: Box], order: inout [String]) {
        guard boxes[folder.path] == nil else { return }
        boxes[folder.path] = Box(attributes: folder.attributes, delimiter: folder.delimiter, uidValidity: uidValidity)
        order.append(folder.path)
    }

    // MARK: Test controls

    public func setCapabilities(_ capabilities: TransportCapabilities) { caps = capabilities }

    /// Make every later `connect` fail with `.auth`.
    public func rejectLogins(_ reject: Bool = true) { rejectedLogins = reject }

    /// The next call to `method` throws `error` (one shot).
    public func failNext(_ method: String, with error: FlintError) { failures[method] = error }

    /// The call to `method` after `skip` more calls throws `error` (one shot).
    public func failNextAfter(_ method: String, skip: Int, with error: FlintError) { delayedFailures[method] = (skip, error) }

    public func addFolder(_ folder: RemoteFolder, uidValidity: Int = 1000) {
        Self.add(folder, uidValidity: uidValidity, to: &boxes, order: &folderOrder)
    }

    public func setUIDValidity(_ value: Int, in path: String) {
        boxes[path]?.uidValidity = value
        boxes[path]?.nextUID = 1
        boxes[path]?.messages = [:]
        boxes[path]?.expungeLog = []
    }

    /// Delivers a message as if it arrived from outside. Returns its UID. Wakes IDLE listeners on that mailbox.
    @discardableResult
    public func deliver(_ envelope: RemoteEnvelope, raw: Data = Data(), parts: [String: Data] = [:], to path: String) -> Int {
        var box = boxes[path] ?? Box(attributes: [], delimiter: "/", uidValidity: 1000)
        if boxes[path] == nil { folderOrder.append(path) }
        var env = envelope
        env.uid = box.nextUID
        box.nextUID += 1
        if caps.condstore { box.highestModseq += 1; env.modseq = box.highestModseq }
        box.messages[env.uid] = Stored(envelope: env, raw: raw, parts: parts)
        boxes[path] = box
        notify(path, .newMessages(exists: box.messages.count))
        return env.uid
    }

    public func removeExternally(uids: [Int], in path: String) {
        guard var box = boxes[path] else { return }
        for uid in uids where box.messages.removeValue(forKey: uid) != nil {
            if caps.condstore { box.highestModseq += 1 }
            box.expungeLog.append((uid, box.highestModseq))
        }
        boxes[path] = box
        notify(path, .expunged)
    }

    public func setFlagsExternally(uids: [Int], flags: Set<String>, in path: String) {
        guard var box = boxes[path] else { return }
        for uid in uids where box.messages[uid] != nil {
            if caps.condstore { box.highestModseq += 1 }
            box.messages[uid]?.envelope.flags = flags
            box.messages[uid]?.envelope.modseq = caps.condstore ? box.highestModseq : nil
        }
        boxes[path] = box
        notify(path, .flagsChanged)
    }

    /// Simulates a network drop: the connection closes and every IDLE stream ends with `.disconnected`.
    public func dropConnection(reason: String? = "connection lost") {
        connected = false
        openConnections = 0
        selectedPath = nil
        for (_, listener) in idleListeners {
            listener.continuation.yield(.disconnected(reason: reason))
            listener.continuation.finish()
        }
        idleListeners = [:]
    }

    /// Replaces a stored message's envelope (flags, Gmail labels, headers) as if it changed on the server. Keeps its UID.
    public func replaceEnvelope(_ envelope: RemoteEnvelope, in path: String) {
        guard var box = boxes[path], var stored = box.messages[envelope.uid] else { return }
        var env = envelope
        if caps.condstore { box.highestModseq += 1; env.modseq = box.highestModseq }
        stored.envelope = env
        box.messages[env.uid] = stored
        boxes[path] = box
        notify(path, .flagsChanged)
    }

    public func envelopes(in path: String) -> [RemoteEnvelope] {
        (boxes[path]?.messages.values.map(\.envelope) ?? []).sorted { $0.uid < $1.uid }
    }

    public func folderPaths() -> [String] { folderOrder }

    // MARK: Helpers

    private func begin(_ name: String, connection: Bool = true) throws {
        calls.append(name)
        if let failure = failures.removeValue(forKey: name) { throw failure }
        if var delayed = delayedFailures[name] {
            if delayed.skip == 0 {
                delayedFailures[name] = nil
                throw delayed.error
            }
            delayed.skip -= 1
            delayedFailures[name] = delayed
        }
        if connection && !connected { throw FlintError(.network, "Not connected.") }
    }

    private func notify(_ path: String, _ event: IdleEvent) {
        for (_, listener) in idleListeners where listener.mailbox == path { listener.continuation.yield(event) }
    }

    private func selectedBox() throws -> (path: String, box: Box) {
        guard let path = selectedPath, let box = boxes[path] else { throw FlintError(.invalid, "No mailbox is selected.") }
        return (path, box)
    }

    /// Resolves a UID set against a mailbox. A range ending in "*" always includes the highest UID, as IMAP does.
    private func resolve(_ set: UIDSet, in box: Box) -> [Int] {
        let existing = box.messages.keys.sorted()
        switch set {
        case .uids(let list): return list.filter { box.messages[$0] != nil }.sorted()
        case .range(let from, let to):
            if let to { return existing.filter { $0 >= min(from, to) && $0 <= max(from, to) } }
            let hit = existing.filter { $0 >= from }
            if hit.isEmpty, let last = existing.last { return [last] }
            return hit
        }
    }

    private func matches(_ criteria: SearchCriteria, _ stored: Stored) throws -> Bool {
        let env = stored.envelope
        switch criteria {
        case .all: return true
        case .since(let date): return (env.internalDate ?? env.date ?? .distantPast) >= date
        case .before(let date): return (env.internalDate ?? env.date ?? .distantPast) < date
        case .uid(let set): return resolveContains(set, uid: env.uid)
        case .seen: return env.flags.contains(IMAPFlag.seen)
        case .unseen: return !env.flags.contains(IMAPFlag.seen)
        case .flagged: return env.flags.contains(IMAPFlag.flagged)
        case .header(let name, let value):
            let key = name.lowercased()
            let actual = key == "message-id" ? env.messageId : env.headers[key]
            return actual?.localizedCaseInsensitiveContains(value) ?? false
        case .text(let text):
            return env.subject.localizedCaseInsensitiveContains(text) || String(decoding: stored.raw, as: UTF8.self).localizedCaseInsensitiveContains(text)
        case .gmailRaw: throw FlintError(.invalid, "X-GM-RAW is not supported by this server.")
        case .and(let list): return try list.allSatisfy { try matches($0, stored) }
        case .not(let inner): return try !matches(inner, stored)
        }
    }

    private func resolveContains(_ set: UIDSet, uid: Int) -> Bool {
        switch set {
        case .uids(let list): return list.contains(uid)
        case .range(let from, let to): return uid >= from && (to.map { uid <= $0 } ?? true)
        }
    }

    private func flagState(_ env: RemoteEnvelope, labels: Bool) -> FlagState {
        FlagState(uid: env.uid, flags: env.flags, labels: labels ? env.gmail?.labels : nil, modseq: env.modseq)
    }

    // MARK: MailTransport

    public func connect(_ configuration: MailTransportConfiguration) async throws {
        try begin("connect", connection: false)
        if rejectedLogins { throw FlintError(.auth, "The server rejected the sign-in.") }
        self.configuration = configuration
        connectCount += 1
        openConnections += 1
        connected = true
    }

    public func updateCredential(_ credential: MailCredential) async {
        calls.append("updateCredential")
        configuration?.credential = credential
    }

    public func disconnect() async {
        calls.append("disconnect")
        openConnections = max(0, openConnections - 1)
        guard openConnections == 0 else { return }
        connected = false
        selectedPath = nil
        for (_, listener) in idleListeners { listener.continuation.finish() }
        idleListeners = [:]
    }

    public var isConnected: Bool { connected }
    public var capabilities: TransportCapabilities { caps }

    public func verifySend() async throws {
        try begin("verifySend", connection: false)
        if rejectedLogins { throw FlintError(.auth, "The server rejected the sign-in.") }
    }

    public func listFolders() async throws -> [RemoteFolder] {
        try begin("listFolders")
        return folderOrder.compactMap { path in boxes[path].map { RemoteFolder(path: path, delimiter: $0.delimiter, attributes: $0.attributes) } }
    }

    public func createFolder(_ path: String) async throws {
        try begin("createFolder")
        Self.add(RemoteFolder(path: path, delimiter: "/"), uidValidity: 1000 + boxes.count, to: &boxes, order: &folderOrder)
    }

    public func select(_ path: String, readOnly: Bool, qresync: QResyncState?) async throws -> SelectResult {
        try begin("select")
        guard let box = boxes[path] else { throw FlintError(.notFound, "No such mailbox.") }
        selectedPath = path
        let mailbox = SelectedMailbox(
            path: path, uidValidity: box.uidValidity, uidNext: box.nextUID, exists: box.messages.count,
            highestModseq: caps.condstore ? box.highestModseq : nil, readOnly: readOnly)
        guard let state = qresync, caps.qresync, state.uidValidity == box.uidValidity else { return SelectResult(mailbox: mailbox) }
        let vanished = box.expungeLog.filter { $0.modseq > state.highestModseq }.map(\.uid)
        let changed = box.messages.values.map(\.envelope).filter { ($0.modseq ?? 0) > state.highestModseq }.sorted { $0.uid < $1.uid }.map { flagState($0, labels: caps.gmail) }
        return SelectResult(mailbox: mailbox, vanishedUIDs: vanished, changedFlags: changed, resynced: true)
    }

    public func search(_ criteria: SearchCriteria) async throws -> [Int] {
        try begin("search")
        let (_, box) = try selectedBox()
        return try box.messages.values.filter { try matches(criteria, $0) }.map(\.envelope.uid).sorted()
    }

    public func fetchEnvelopes(_ uids: UIDSet, options: EnvelopeFetchOptions) async throws -> [RemoteEnvelope] {
        try begin("fetchEnvelopes")
        let (_, box) = try selectedBox()
        return resolve(uids, in: box).compactMap { uid in
            guard var env = box.messages[uid]?.envelope else { return nil }
            if !options.bodyStructure { env.bodyStructure = nil }
            if !(options.gmail && caps.gmail) { env.gmail = nil }
            let wanted = Set(options.headers.map { $0.lowercased() })
            env.headers = env.headers.filter { wanted.contains($0.key) }
            return env
        }
    }

    public func fetchFlags(_ uids: UIDSet, includeLabels: Bool, changedSince: UInt64?) async throws -> [FlagState] {
        try begin("fetchFlags")
        if changedSince != nil && !caps.condstore { throw FlintError(.invalid, "The server does not support CHANGEDSINCE.") }
        let (_, box) = try selectedBox()
        return resolve(uids, in: box).compactMap { uid in
            guard let env = box.messages[uid]?.envelope else { return nil }
            if let since = changedSince, (env.modseq ?? 0) <= since { return nil }
            return flagState(env, labels: includeLabels && caps.gmail)
        }
    }

    public func fetchBodyStructure(uid: Int) async throws -> BodyPart? {
        try begin("fetchBodyStructure")
        return try selectedBox().box.messages[uid]?.envelope.bodyStructure
    }

    public func fetchPart(uid: Int, part: String) async throws -> Data {
        try begin("fetchPart")
        guard let stored = try selectedBox().box.messages[uid] else { throw FlintError(.notFound, "No such message.") }
        if let data = stored.parts[part] { return data }
        throw FlintError(.notFound, "No such part.")
    }

    public func fetchRawMessage(uid: Int) async throws -> Data {
        try begin("fetchRawMessage")
        guard let stored = try selectedBox().box.messages[uid] else { throw FlintError(.notFound, "No such message.") }
        return stored.raw
    }

    public func storeFlags(_ uids: UIDSet, flags: [String], mode: FlagMode) async throws {
        try begin("storeFlags")
        let (path, box) = try selectedBox()
        guard !(boxes[path]?.attributes.contains("readonly") ?? false) else { throw FlintError(.permission, "Mailbox is read-only.") }
        var updated = box
        for uid in resolve(uids, in: box) {
            var current = updated.messages[uid]!.envelope.flags
            switch mode {
            case .add: current.formUnion(flags)
            case .remove: current.subtract(flags)
            case .replace: current = Set(flags)
            }
            if caps.condstore { updated.highestModseq += 1 }
            updated.messages[uid]?.envelope.flags = current
            updated.messages[uid]?.envelope.modseq = caps.condstore ? updated.highestModseq : nil
        }
        boxes[path] = updated
        notify(path, .flagsChanged)
    }

    public func move(_ uids: UIDSet, to destination: String) async throws -> [Int: Int] {
        try begin("move")
        let mapping = try copyMessages(uids, to: destination)
        try removeMessages(uids)
        return mapping
    }

    public func copy(_ uids: UIDSet, to destination: String) async throws -> [Int: Int] {
        try begin("copy")
        return try copyMessages(uids, to: destination)
    }

    private func copyMessages(_ uids: UIDSet, to destination: String) throws -> [Int: Int] {
        let (_, box) = try selectedBox()
        guard boxes[destination] != nil else { throw FlintError(.notFound, "No such mailbox.") }
        var mapping: [Int: Int] = [:]
        for uid in resolve(uids, in: box) {
            guard let stored = box.messages[uid] else { continue }
            mapping[uid] = deliver(stored.envelope, raw: stored.raw, parts: stored.parts, to: destination)
        }
        return caps.uidPlus ? mapping : [:]
    }

    private func removeMessages(_ uids: UIDSet) throws {
        let (path, box) = try selectedBox()
        let doomed = resolve(uids, in: box)
        guard var updated = boxes[path] else { return }
        for uid in doomed {
            updated.messages[uid] = nil
            if caps.condstore { updated.highestModseq += 1 }
            updated.expungeLog.append((uid, updated.highestModseq))
        }
        boxes[path] = updated
        notify(path, .expunged)
    }

    public func expunge(_ uids: UIDSet) async throws {
        try begin("expunge")
        try removeMessages(uids)
    }

    public func append(_ raw: Data, to path: String, flags: [String], date: Date?) async throws -> Int? {
        try begin("append")
        guard boxes[path] != nil else { throw FlintError(.notFound, "No such mailbox.") }
        let headers = Self.parseHeaders(raw)
        let envelope = RemoteEnvelope(
            uid: 0, flags: Set(flags), internalDate: date ?? Date(), size: raw.count, messageId: headers["message-id"],
            inReplyTo: headers["in-reply-to"], subject: headers["subject"] ?? "", date: date, headers: headers)
        let uid = deliver(envelope, raw: raw, to: path)
        return caps.uidPlus ? uid : nil
    }

    public func idle(mailbox: String) async -> AsyncStream<IdleEvent> {
        calls.append("idle")
        let id = UUID()
        let (stream, continuation) = AsyncStream<IdleEvent>.makeStream()
        guard connected, boxes[mailbox] != nil else {
            continuation.yield(.disconnected(reason: connected ? "no such mailbox" : "not connected"))
            continuation.finish()
            return stream
        }
        idleListeners[id] = (mailbox, continuation)
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeListener(id) }
        }
        return stream
    }

    private func removeListener(_ id: UUID) { idleListeners[id] = nil }

    public func send(_ message: OutgoingMessage) async throws {
        try begin("send", connection: false)
        if rejectedLogins { throw FlintError(.auth, "The server rejected the sign-in.") }
        guard !message.recipients.isEmpty else { throw FlintError(.invalid, "No recipients.") }
        sentMessages.append(message)
    }

    /// Header names lower-cased, folded lines joined, first value wins. Good enough for tests.
    static func parseHeaders(_ raw: Data) -> [String: String] {
        let text = String(decoding: raw, as: UTF8.self)
        let head = text.components(separatedBy: "\r\n\r\n").first ?? text
        var out: [String: String] = [:]
        var current: (name: String, value: String)?
        func flush() {
            if let c = current, out[c.name] == nil { out[c.name] = c.value }
            current = nil
        }
        for line in head.components(separatedBy: "\r\n") {
            if line.first == " " || line.first == "\t" {
                if var c = current { c.value += " " + line.trimmingCharacters(in: .whitespaces); current = c }
            } else if let colon = line.firstIndex(of: ":") {
                flush()
                current = (line[..<colon].lowercased(), line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces))
            }
        }
        flush()
        return out
    }
}

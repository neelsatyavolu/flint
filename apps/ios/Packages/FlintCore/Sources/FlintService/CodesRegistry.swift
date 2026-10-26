// Recently detected verification codes: kept for ten minutes, listed newest first, marked used when the user copies or
// fills one. Codes are credentials, so they live only in the app's own database (kv_cache with a TTL), never in logs.
// Detection itself is `CodeDetector` (FlintClassify); this is the storing and TTL the HANDOFF leaves to the facade.

import FlintClassify
import FlintHTML
import FlintModel
import FlintStore
import Foundation

actor CodesRegistry {
    static let storageKey = "codes:recent"
    /// A message older than this is not "just arrived" and gets no code.
    static let maxAgeMs = 15 * 60 * 1000
    /// Mail dated further ahead than this is not just arrived either (a wrong clock on the sender).
    static let futureSlackMs = 10 * 60 * 1000
    static let maxRemembered = 500
    /// Roles whose mail never produces a code.
    static let skippedRoles: Set<MailboxRole> = [.spam, .trash, .sent, .drafts]

    private let store: any Store
    private let detector: CodeDetector
    private let now: @Sendable () -> EpochMs
    private var codes: [VerificationCode] = []
    private var loaded = false
    private var scanned: [MessageRowID] = []

    init(store: any Store, now: @escaping @Sendable () -> EpochMs) {
        self.store = store
        self.now = now
        self.detector = CodeDetector(htmlToText: { HTMLText.htmlToText($0) })
    }

    // MARK: Reading

    func list(includeUsed: Bool = true) async -> [VerificationCode] {
        await load()
        return live().filter { includeUsed || !$0.used }.sorted { $0.receivedAt > $1.receivedAt }
    }

    func badge(messageId: MessageRowID) async -> CodeBadge? {
        await load()
        return live().first { $0.messageId == messageId }.map(CodeBadge.init)
    }

    func badge(threadId: ThreadID) async -> CodeBadge? {
        await load()
        return live().filter { $0.threadId == threadId }.max { $0.receivedAt < $1.receivedAt }.map(CodeBadge.init)
    }

    func badges(threadIds: [ThreadID]) async -> [ThreadID: CodeBadge] {
        await load()
        var out: [ThreadID: CodeBadge] = [:]
        for code in live().sorted(by: { $0.receivedAt < $1.receivedAt }) where threadIds.contains(code.threadId) { out[code.threadId] = CodeBadge(code) }
        return out
    }

    /// Marks a code used. Returns it so the caller can announce the change, or nil when it is unknown or already used.
    func markUsed(_ id: String) async -> VerificationCode? {
        await load()
        guard let index = codes.firstIndex(where: { $0.id == id }), !codes[index].used else { return nil }
        codes[index].used = true
        await persist()
        return codes[index]
    }

    // MARK: Detection

    /// Looks at a thread's fresh unread messages and registers a code for each one that has one. Returns the new codes.
    func scan(threadId: ThreadID) async -> [VerificationCode] {
        await load()
        guard let rows = try? await store.threadRows(threadId) else { return [] }
        let current = now()
        let blocked = (try? await store.blockedPatterns()) ?? []
        let fresh = rows.messages.filter { m in
            !scanned.contains(m.id) && !m.seen && !m.draft && !m.isFromMe && !m.inSent
                && m.date >= current - Self.maxAgeMs && m.date <= current + Self.futureSlackMs
                && !m.from.contains { CodeScan.blocked($0.address, blocked) }
        }
        guard !fresh.isEmpty else { return [] }
        let locations = (try? await store.messageLocations(fresh.map(\.id))) ?? []
        let roles = Dictionary(locations.map { ($0.messageRowId, $0.folderRole) }, uniquingKeysWith: { first, _ in first })
        var added: [VerificationCode] = []
        for message in fresh {
            remember(message.id)
            if let role = roles[message.id] ?? nil, Self.skippedRoles.contains(role) { continue }
            let from = message.from.first ?? Address(address: "")
            let input = DetectInput(subject: message.subject, text: message.text, html: message.rawHtml, fromName: from.name.isEmpty ? nil : from.name, fromAddress: from.address)
            guard let found = detector.detect(input) else { continue }
            let code = VerificationCode(
                id: UUID().uuidString.lowercased(), code: found.code, service: found.service, senderAddress: from.address,
                senderDomain: CodeDetector.senderDomain(of: from.address), threadId: message.threadId, messageId: message.id,
                accountId: message.accountId, receivedAt: message.date, expiresAt: current + VerificationCode.ttlMs)
            codes.append(code)
            added.append(code)
        }
        if !added.isEmpty { await persist() }
        return added
    }

    func clear() async {
        codes = []
        scanned = []
        try? await store.kvDelete(Self.storageKey)
    }

    // MARK: Storage

    private func remember(_ id: MessageRowID) {
        scanned.append(id)
        if scanned.count > Self.maxRemembered { scanned.removeFirst(scanned.count - Self.maxRemembered) }
    }

    private func live() -> [VerificationCode] {
        let current = now()
        return codes.filter { $0.expiresAt > current }
    }

    private func load() async {
        guard !loaded else { return }
        loaded = true
        guard let raw = try? await store.kvGet(Self.storageKey, now: now()), let data = raw.data(using: .utf8),
              let stored = try? JSONDecoder().decode([VerificationCode].self, from: data) else { return }
        codes = stored
    }

    private func persist() async {
        codes = live()
        guard let data = try? JSONEncoder().encode(codes) else { return }
        try? await store.kvSet(Self.storageKey, String(decoding: data, as: UTF8.self), ttlMs: VerificationCode.ttlMs, now: now())
    }
}

enum CodeScan {
    static func blocked(_ address: String, _ patterns: Set<String>) -> Bool {
        RuleMatcher.senderMatchesBlocked(address, patterns: patterns)
    }
}

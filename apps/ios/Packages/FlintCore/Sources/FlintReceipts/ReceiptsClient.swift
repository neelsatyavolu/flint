import FlintModel
import FlintStore
import Foundation

public struct ReceiptsCredentials: Codable, Hashable, Sendable {
    public var installId: String
    public var secret: String
    public var endpoint: String?
}

public struct PrepareTrackedInput: Sendable {
    public var accountId: AccountID
    public var subject: String
    public var messageId: String
    public var recipients: [Address]
    /// The user's own addresses and aliases (compared by canonical address).
    public var selfAddresses: [String]

    public init(accountId: AccountID, subject: String, messageId: String, recipients: [Address], selfAddresses: [String]) {
        self.accountId = accountId
        self.subject = subject
        self.messageId = messageId
        self.recipients = recipients
        self.selfAddresses = selfAddresses
    }
}

public struct PreparedTracking: Sendable, Hashable {
    public struct Recipient: Sendable, Hashable {
        public var address: Address
        public var token: String
        public var pixelURL: String
    }

    public var ref: String
    public var perRecipient: [Recipient]
    public var untracked: [Address]
}

/// Client for the Flint receipts service (port of packages/core/src/receipts/client.ts). Never logs tokens or secrets.
/// Reply detection (`markReplied` on desktop) is not here: the store derives replied status in
/// `recomputeReceipts(threadId:)` and ingest outcomes carry `receiptChanges`; pass those to `notify(_:)`.
public actor ReceiptsClient {
    public static let credentialsKey = "receipts:credentials"
    static let cursorKey = "receipts:cursor"
    static let maxPagesPerPoll = 20

    public typealias ReceiptsStore = ReceiptsRepository & KeyValueRepository

    private let store: any ReceiptsStore
    private let secrets: any SecretStore
    private let transport: any ReceiptsTransport
    private let receiptsSettings: @Sendable () async -> Settings.Receipts
    private let now: @Sendable () -> EpochMs
    private let emit: @Sendable (FlintEvent) -> Void
    private let timeout: TimeInterval
    private var installing: Task<ReceiptsCredentials, Error>?

    public init(
        store: any ReceiptsStore,
        secrets: any SecretStore,
        receiptsSettings: @escaping @Sendable () async -> Settings.Receipts,
        transport: any ReceiptsTransport = URLSessionReceiptsTransport(),
        now: @escaping @Sendable () -> EpochMs = { Int(Date().timeIntervalSince1970 * 1000) },
        emit: @escaping @Sendable (FlintEvent) -> Void = { _ in },
        timeout: TimeInterval = 8
    ) {
        self.store = store
        self.secrets = secrets
        self.receiptsSettings = receiptsSettings
        self.transport = transport
        self.now = now
        self.emit = emit
        self.timeout = timeout
    }

    // MARK: - Configuration and install

    /// True when receipts are switched on and an endpoint is configured.
    public func isConfigured() async -> Bool {
        let s = await receiptsSettings()
        return s.enabled && ReceiptPixel.normalizeEndpoint(s.endpoint) != nil
    }

    private func endpoint() async -> String? {
        ReceiptPixel.normalizeEndpoint(await receiptsSettings().endpoint)
    }

    /// Registers this install with the service once and keeps the credentials in the secret store.
    @discardableResult
    public func ensureInstall() async throws -> ReceiptsCredentials {
        guard let endpoint = await endpoint() else {
            throw FlintError(.invalid, "Read receipts need a service address. Add one in Settings.")
        }
        if let task = installing { return try await task.value }
        let task = Task { try await self.install(endpoint) }
        installing = task
        defer { installing = nil }
        return try await task.value
    }

    private func install(_ endpoint: String) async throws -> ReceiptsCredentials {
        if let raw = try? await secrets.get(Self.credentialsKey),
           let stored = try? JSONDecoder().decode(ReceiptsCredentials.self, from: Data(raw.utf8)),
           (stored.endpoint ?? endpoint) == endpoint {
            return stored
        }
        let response = try await ReceiptsHTTP.call(
            CallOptions(transport: transport, baseURL: endpoint, timeout: timeout, bearer: nil),
            method: "POST", path: "/v1/install", body: ReceiptsWire.Empty(), as: ReceiptsWire.InstallResponse.self
        )
        let credentials = ReceiptsCredentials(installId: response.installId, secret: response.secret, endpoint: endpoint)
        try await secrets.set(Self.credentialsKey, value: String(decoding: try JSONEncoder().encode(credentials), as: UTF8.self))
        return credentials
    }

    /// Authenticated call. A 401 means the service forgot this install, so install again once and retry.
    private func authenticated<R: Decodable>(_ method: String, _ path: String, body: (any Encodable & Sendable)? = nil, as type: R.Type) async throws -> R {
        guard let endpoint = await endpoint() else {
            throw FlintError(.invalid, "Read receipts need a service address. Add one in Settings.")
        }
        for attempt in 0... {
            let credentials = try await ensureInstall()
            let options = CallOptions(transport: transport, baseURL: endpoint, timeout: timeout, bearer: "\(credentials.installId).\(credentials.secret)")
            do {
                return try await ReceiptsHTTP.call(options, method: method, path: path, body: body, as: type)
            } catch let error as ServiceHTTPError where error.status == 401 && attempt == 0 {
                try await secrets.delete(Self.credentialsKey)
            }
        }
        throw FlintError(.internal, "unreachable")
    }

    // MARK: - Sending

    /// Generates a token per recipient and registers them. Never throws for service problems: on any failure every
    /// recipient comes back untracked and the tracked row is marked unregistered.
    public func prepareTracked(_ input: PrepareTrackedInput) async throws -> PreparedTracking {
        let ref = ReceiptPixel.newToken()
        let own = Set(input.selfAddresses.map(ReceiptPixel.canonicalAddress))
        var seen = Set<String>()
        var candidates: [Address] = []
        var untracked: [Address] = []
        for recipient in input.recipients {
            let key = ReceiptPixel.canonicalAddress(recipient.address)
            if key.isEmpty || !seen.insert(key).inserted { continue }
            if own.contains(key) || candidates.count >= ReceiptsWire.maxRecipients { untracked.append(recipient) } else { candidates.append(recipient) }
        }
        let settings = await receiptsSettings()
        if !settings.enabled || candidates.isEmpty {
            return PreparedTracking(ref: ref, perRecipient: [], untracked: candidates + untracked)
        }
        let tokens = candidates.map { _ in ReceiptPixel.newToken() }
        var state = NewTracked.State.unregistered
        let endpoint = ReceiptPixel.normalizeEndpoint(settings.endpoint)
        if endpoint != nil {
            do {
                let body = ReceiptsWire.RegisterRequest(ref: ref, recipients: tokens.map { .init(token: $0) })
                _ = try await authenticated("POST", "/v1/messages", body: body, as: ReceiptsWire.RegisterResponse.self)
                state = .active
            } catch {
                // Registration problems are not fatal; the mail goes out untracked.
            }
        }
        _ = try await store.createTracked(NewTracked(
            accountId: input.accountId, ref: ref, messageId: Self.stripBrackets(input.messageId), subject: input.subject, sentAt: now(), state: state,
            recipients: zip(candidates, tokens).map { .init(email: $0.address, name: $0.name, token: $1) }
        ))
        guard state == .active, let endpoint else {
            return PreparedTracking(ref: ref, perRecipient: [], untracked: candidates + untracked)
        }
        let perRecipient = zip(candidates, tokens).map {
            PreparedTracking.Recipient(address: $0, token: $1, pixelURL: ReceiptPixel.pixelURL(endpoint: endpoint, token: $1))
        }
        return PreparedTracking(ref: ref, perRecipient: perRecipient, untracked: untracked)
    }

    /// Records a message the user asked to track that went out without tracking, so the Receipts list shows it as
    /// untracked with the reason instead of leaving no trace. Nothing is registered and no pixel is added.
    /// Returns nil when no recipient besides the user remains.
    public func recordUntracked(_ input: PrepareTrackedInput, reason: String) async throws -> String? {
        let own = Set(input.selfAddresses.map(ReceiptPixel.canonicalAddress))
        var seen = Set<String>()
        var recipients: [NewTracked.Recipient] = []
        for recipient in input.recipients {
            let key = ReceiptPixel.canonicalAddress(recipient.address)
            if key.isEmpty || own.contains(key) || recipients.count >= ReceiptsWire.maxRecipients || !seen.insert(key).inserted { continue }
            recipients.append(.init(email: recipient.address, name: recipient.name, token: ReceiptPixel.newToken()))
        }
        if recipients.isEmpty { return nil }
        let ref = ReceiptPixel.newToken()
        _ = try await store.createTracked(NewTracked(
            accountId: input.accountId, ref: ref, messageId: Self.stripBrackets(input.messageId), subject: input.subject, sentAt: now(),
            state: .unregistered, untrackedReason: reason, recipients: recipients
        ))
        return ref
    }

    // MARK: - Polling

    /// Fetches new events, stores them (idempotent on the service event id), recomputes recipient status through the
    /// store and emits `.receipt` events for status changes when `notifyOnOpen` is on.
    /// Returns how many counted opens arrived in this poll.
    public func pollEvents() async throws -> Int {
        guard await isConfigured() else { return 0 }
        let credentials = try await ensureInstall()
        var cursor = await loadCursor(installId: credentials.installId)
        let notify = await receiptsSettings().notifyOnOpen
        var statuses = notify ? await statusSnapshot() : [:]
        var opens = 0
        for _ in 0..<Self.maxPagesPerPoll {
            let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? cursor
            let page = try await authenticated(
                "GET", "/v1/events?after=\(encoded)&limit=\(ReceiptsWire.maxEventsLimit)", as: ReceiptsWire.EventsResponse.self
            )
            if !page.events.isEmpty {
                opens += page.events.filter { $0.kind == .open }.count
                let changes = try await store.ingestReceiptEvents(page.events.map(Self.input(from:)), now: now())
                if notify { emitChanges(changes, previous: &statuses) }
            }
            let advanced = page.cursor != cursor
            cursor = page.cursor
            await saveCursor(installId: credentials.installId, cursor: cursor)
            if page.events.count < ReceiptsWire.maxEventsLimit || !advanced { break }
        }
        return opens
    }

    private static func input(from e: ReceiptsWire.Event) -> ReceiptEventInput {
        let location = [e.city, e.country].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
        return ReceiptEventInput(
            remoteId: String(e.id), token: e.token, at: e.at, kind: e.kind, client: e.client, device: e.device,
            location: location.isEmpty ? nil : location, fingerprint: e.fingerprint
        )
    }

    private func statusSnapshot() async -> [String: ReceiptStatus] {
        var out: [String: ReceiptStatus] = [:]
        let pollable = (try? await store.listPollable(sinceMs: 0)) ?? []
        for item in pollable {
            guard let tracked = try? await store.tracked(id: item.trackedId) else { continue }
            for r in tracked.recipients { out["\(item.trackedId)|\(r.email)"] = r.status }
        }
        return out
    }

    private func emitChanges(_ changes: [ReceiptChange], previous: inout [String: ReceiptStatus]) {
        for change in changes {
            guard let status = ReceiptStatus(rawValue: change.status) else { continue }
            let key = "\(change.trackedId)|\(change.email)"
            if previous[key] == status { continue }
            previous[key] = status
            emit(.receipt(trackedId: change.trackedId, email: change.email, status: status, at: change.at))
        }
    }

    /// Emits `.receipt` events for changes the store reported outside of polling (a reply arriving in a tracked thread).
    public nonisolated func notify(_ changes: [ReceiptChange]) {
        for change in changes {
            guard let status = ReceiptStatus(rawValue: change.status) else { continue }
            emit(.receipt(trackedId: change.trackedId, email: change.email, status: status, at: change.at))
        }
    }

    // MARK: - Maintenance

    /// Tells the service this device's address so hits from it are recognized as the sender. False when it failed.
    public func seenPing() async -> Bool {
        guard await isConfigured() else { return false }
        do {
            _ = try await authenticated("POST", "/v1/seen", body: ReceiptsWire.Empty(), as: ReceiptsWire.Ok.self)
            return true
        } catch {
            return false
        }
    }

    /// Stops tracking: asks the service to forget the message, then marks it stopped locally.
    public func stopTracking(_ trackedId: Int) async throws {
        guard try await store.tracked(id: trackedId) != nil else {
            throw FlintError(.notFound, "That tracked message no longer exists.")
        }
        // Only active rows are pollable; unregistered rows never reached the service.
        if let active = try await store.listPollable(sinceMs: 0).first(where: { $0.trackedId == trackedId }) {
            let ref = active.ref.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? active.ref
            do {
                let response = try await authenticated("DELETE", "/v1/messages/\(ref)", as: ReceiptsWire.DeleteResponse.self)
                // 202 { ok: false, deleted: false }: the service couldn't delete yet. Keep the row active so the user can retry.
                if !response.ok || response.deleted == false {
                    throw FlintError(.network, "The receipts service couldn't stop tracking yet. Try again later.")
                }
            } catch let error as ServiceHTTPError where error.status == 404 {
                // Already gone on the service: fine.
            } catch let error as FlintError {
                throw error
            } catch {
                throw FlintError(.network, "Couldn't reach the receipts service. Try again.")
            }
        }
        try await store.setTrackedState(trackedId, .stopped)
    }

    // MARK: - Cursor

    private struct StoredCursor: Codable { var installId: String; var cursor: String }

    private func loadCursor(installId: String) async -> String {
        guard let raw = try? await store.kvGet(Self.cursorKey, now: now()),
              let stored = try? JSONDecoder().decode(StoredCursor.self, from: Data(raw.utf8)),
              stored.installId == installId else { return "0" }
        return stored.cursor
    }

    private func saveCursor(installId: String, cursor: String) async {
        guard let data = try? JSONEncoder().encode(StoredCursor(installId: installId, cursor: cursor)) else { return }
        try? await store.kvSet(Self.cursorKey, String(decoding: data, as: UTF8.self), ttlMs: nil, now: now())
    }

    private static func stripBrackets(_ id: String) -> String {
        var s = Substring(id)
        while s.hasPrefix("<") { s = s.dropFirst() }
        while s.hasSuffix(">") { s = s.dropLast() }
        return String(s)
    }
}

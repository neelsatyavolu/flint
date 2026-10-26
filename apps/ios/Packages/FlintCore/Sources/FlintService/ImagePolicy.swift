// Per-message and per-sender remote image permissions, kept in kv_cache. Port of packages/core/src/service/imagePolicy.ts.

import FlintModel
import FlintStore
import Foundation

struct SenderTrust: Sendable {
    /// The message is from one of the user's addresses.
    var isFromMe: Bool
    /// The message sits in a Sent folder, which only mail that left this account can.
    var inSent: Bool
    var headers: [String: String]
}

enum AuthOutcome: Sendable { case pass, fail, unknown }

struct ImagePolicy: Sendable {
    static let sendersKey = "images:senders"
    static func messageKey(_ id: MessageRowID) -> String { "images:message:\(id)" }

    let mode: Settings.Inbox.RemoteImages
    let senders: Set<String>
    let messagesAllowed: Set<MessageRowID>
    let sentTo: Set<String>

    /// "fail" when the receiving server recorded a DKIM/SPF/DMARC failure, "pass" when it recorded a pass, else "unknown".
    static func authOutcome(_ headers: [String: String]) -> AuthOutcome {
        guard let value = headers["authentication-results"]?.lowercased() else { return .unknown }
        if value.range(of: #"\b(dkim|spf|dmarc)=(fail|softfail|permerror|temperror)\b"#, options: .regularExpression) != nil { return .fail }
        let passed = value.range(of: #"\b(dkim|dmarc)=pass\b"#, options: .regularExpression) != nil
            || value.range(of: #"\bspf=pass\b"#, options: .regularExpression) != nil
        return passed ? .pass : .unknown
    }

    func allowed(messageId: MessageRowID, from: [Address], trust: SenderTrust) -> Bool {
        if messagesAllowed.contains(messageId) { return true }
        switch mode {
        case .always: return true
        case .never: return false
        case .knownSenders: break
        }
        guard let address = from.first?.address.lowercased() else { return false }
        // A From header alone proves nothing: phishing forges the reader's own address and their contacts'.
        let auth = Self.authOutcome(trust.headers)
        if auth == .fail { return false }
        if trust.isFromMe && !trust.inSent && auth != .pass { return false }
        // A server that recorded Authentication-Results but no pass vouches for nothing.
        if !(trust.isFromMe && trust.inSent), trust.headers["authentication-results"] != nil, auth != .pass { return false }
        return trust.isFromMe || senders.contains(address) || sentTo.contains(address)
    }
}

extension ServiceCore {
    /// Reads the allowances for these messages in one go, so a thread is built without a query per message.
    func imagePolicy(settings: Settings, for messages: [StoredMessage]) async -> ImagePolicy {
        let list = (try? await store.kvGet(ImagePolicy.sendersKey, now: now())).flatMap { raw in
            raw.data(using: .utf8).flatMap { try? JSONDecoder().decode([String].self, from: $0) }
        } ?? []
        var allowed = Set<MessageRowID>()
        var sentTo = Set<String>()
        for message in messages {
            if (try? await store.kvGet(ImagePolicy.messageKey(message.id), now: now())) != nil { allowed.insert(message.id) }
            if let address = message.from.first?.address.lowercased(), !sentTo.contains(address), (try? await store.hasSentTo(address)) == true {
                sentTo.insert(address)
            }
        }
        return ImagePolicy(mode: settings.inbox.remoteImages, senders: Set(list), messagesAllowed: allowed, sentTo: sentTo)
    }

    /// Allows remote images for this message, and for the sender in future when `always`.
    func allowImages(messageId: MessageRowID, from: [Address], always: Bool) async throws {
        try await store.kvSet(ImagePolicy.messageKey(messageId), "1", ttlMs: nil, now: now())
        guard always, let address = from.first?.address.lowercased() else { return }
        let existing = (try? await store.kvGet(ImagePolicy.sendersKey, now: now())).flatMap { $0.data(using: .utf8) }.flatMap { try? JSONDecoder().decode([String].self, from: $0) } ?? []
        let merged = Array(Set(existing + [address])).sorted()
        try await store.kvSet(ImagePolicy.sendersKey, String(decoding: try JSONEncoder().encode(merged), as: UTF8.self), ttlMs: nil, now: now())
    }
}

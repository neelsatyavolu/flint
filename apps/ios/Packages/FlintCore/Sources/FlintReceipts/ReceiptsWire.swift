import FlintModel
import Foundation

/// Wire schemas for the Flint receipts service. Mirrors services/receipts/src/protocol.ts (copied through
/// packages/core/src/receipts/protocol.ts). Keep the three in step.
enum ReceiptsWire {
    static let maxRecipients = 100
    static let maxEventsLimit = 500

    struct InstallResponse: Decodable { var installId: String; var secret: String }

    struct RegisterRequest: Encodable, Sendable {
        struct Recipient: Encodable, Sendable { var token: String }
        var ref: String
        var recipients: [Recipient]
    }

    struct RegisterResponse: Decodable { var ref: String; var recipients: Int }

    struct Event: Decodable {
        var id: Int
        var token: String
        var at: Int
        var kind: ReceiptEventKind
        var client: String?
        var device: String?
        var country: String?
        var city: String?
        var fingerprint: String
        var possiblyForwarded: Bool
    }

    struct EventsResponse: Decodable { var events: [Event]; var cursor: String }

    struct ErrorResponse: Decodable {
        struct Body: Decodable { var code: String; var message: String }
        var error: Body
    }

    /// `{ ok: true }`.
    struct Ok: Decodable {
        var ok: Bool
        init(from decoder: Decoder) throws {
            ok = try decoder.container(keyedBy: Key.self).decode(Bool.self, forKey: .ok)
            guard ok else { throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "ok must be true")) }
        }
        enum Key: String, CodingKey { case ok }
    }

    /// DELETE answers 202 `{ ok: false, deleted: false }` when the service's storage failed.
    struct DeleteResponse: Decodable { var ok: Bool; var deleted: Bool? }

    struct Empty: Encodable, Sendable {}
}

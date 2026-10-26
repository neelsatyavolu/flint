import Foundation
import Testing
@testable import FlintModel

private func json(_ text: String) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
}

private func jsonValue<T: Encodable>(_ value: T) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
}

@Suite("FlintModel codable")
struct ModelCodableTests {
    static let server = ServerConfig(imapHost: "imap.example.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.example.com", smtpPort: 465, smtpSecure: true, username: "me@example.com")

    @Test func accountEncodesFlatLikeTypeScript() throws {
        let account = Account(id: "a1", email: "me@example.com", name: "Me", provider: .imap, authKind: .password, server: Self.server, aliases: ["alias@example.com"], createdAt: 5)
        let value = try jsonValue(account)
        guard case .object(let object) = value else { Issue.record("not an object"); return }
        #expect(object["imapHost"] == .string("imap.example.com"))
        #expect(object["smtpPort"] == .number(465))
        #expect(object["authKind"] == .string("password"))
        #expect(object["color"] == .null)
        #expect(object["server"] == nil)
    }

    @Test func accountDecodesDesktopRow() throws {
        let text = """
        {"id":"g1","email":"me@gmail.com","name":"Me","provider":"gmail","authKind":"oauth_google","imapHost":"imap.gmail.com","imapPort":993,
        "imapSecure":true,"smtpHost":"smtp.gmail.com","smtpPort":465,"smtpSecure":true,"username":"me@gmail.com","color":null,"sortOrder":2,
        "enabled":true,"aliases":[],"createdAt":1700000000000,"showInUnified":false,"avatarSource":"google","avatarUpdatedAt":9}
        """
        let account = try JSONDecoder().decode(Account.self, from: Data(text.utf8))
        #expect(account.authKind == .oauthGoogle)
        #expect(account.server.imapHost == "imap.gmail.com")
        #expect(account.showInUnified == false)
        #expect(account.avatarSource == .google)
        let again = try JSONDecoder().decode(Account.self, from: JSONEncoder().encode(account))
        #expect(again == account)
    }

    @Test func autoconfigResultIsFlat() throws {
        let result = AutoconfigResult(server: Self.server, hint: .protonBridge)
        let value = try jsonValue(result)
        guard case .object(let object) = value else { Issue.record("not an object"); return }
        #expect(object["hint"] == .string("proton_bridge"))
        #expect(object["imapHost"] == .string("imap.example.com"))
        #expect(try JSONDecoder().decode(AutoconfigResult.self, from: JSONEncoder().encode(result)) == result)
    }

    @Test func ruleActionsUseTypeTag() throws {
        let actions: [RuleAction] = [.move(folderPath: "Receipts"), .archive, .markRead, .category(.newsletters), .notify(enabled: false)]
        let data = try JSONEncoder().encode(actions)
        #expect(try JSONDecoder().decode([RuleAction].self, from: data) == actions)
        let wire = try json(#"[{"type":"mark_read"},{"type":"category","category":"notifications"},{"type":"notify","enabled":true}]"#)
        let decoded = try JSONDecoder().decode([RuleAction].self, from: JSONEncoder().encode(wire))
        #expect(decoded == [.markRead, .category(.notifications), .notify(enabled: true)])
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(RuleAction.self, from: Data(#"{"type":"nope"}"#.utf8)) }
    }

    @Test func accountSecretShapes() throws {
        let password = try JSONDecoder().decode(AccountSecret.self, from: Data(#"{"password":"pw"}"#.utf8))
        #expect(password == .password("pw"))
        let oauth = try JSONDecoder().decode(AccountSecret.self, from: Data(#"{"accessToken":"a","refreshToken":"r","expiresAt":42}"#.utf8))
        #expect(oauth == .oauth(accessToken: "a", refreshToken: "r", expiresAt: 42))
        #expect(try jsonValue(oauth) == json(#"{"accessToken":"a","refreshToken":"r","expiresAt":42}"#))
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(AccountSecret.self, from: Data("{}".utf8)) }
    }

    @Test func enumRawValuesMatchTypeScript() throws {
        #expect(SyncState.authError.rawValue == "auth_error")
        #expect(ScheduledSendStatus.awaitingApproval.rawValue == "awaiting_approval")
        #expect(RuleField.anyRecipient.rawValue == "any_recipient")
        #expect(PendingKind.moveFolder.rawValue == "move_folder")
        #expect(FlintErrorCode.aiNotConnected.rawValue == "ai_not_connected")
        #expect(ReceiptEventKind.`self`.rawValue == "self")
    }

    @Test func flintErrorRoundTrips() throws {
        let error = FlintError(.auth, "Sign in again.")
        #expect(try JSONDecoder().decode(FlintError.self, from: JSONEncoder().encode(error)) == error)
        #expect(error.description == "auth: Sign in again.")
    }

    @Test func jsonValueMergesDeeply() throws {
        let base = try json(#"{"a":{"b":1,"c":[1,2]},"d":true}"#)
        let patch = try json(#"{"a":{"c":[3]},"e":"x"}"#)
        #expect(base.merging(patch) == (try json(#"{"a":{"b":1,"c":[3]},"d":true,"e":"x"}"#)))
        #expect(base.merging(.number(1)) == .number(1))
    }

    @Test func codeBadgeFromCode() {
        let code = VerificationCode(id: "i", code: "123456", service: "KAYAK", senderAddress: "a@kayak.com", senderDomain: "kayak.com", threadId: 1, messageId: 2, accountId: "a", receivedAt: 0, expiresAt: VerificationCode.ttlMs)
        let badge = CodeBadge(code)
        #expect(badge.code == "123456" && badge.expiresAt == 600_000 && !badge.used)
    }
}

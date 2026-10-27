import CryptoKit
import FlintModel
import FlintPairing
import Foundation

/// A Mac that lives inside the app, for the seeded demo (`-FlintSeed demo`): the simulator has no camera and a demo mailbox has
/// no Mac to scan. It speaks the real protocol through `PairingClient`, so the demo walks the same code and crypto as a
/// real pairing. It touches no network and uses made-up accounts.
final class DemoMac: @unchecked Sendable {
    let keypair = PairingKeypair.generate()
    let sid = Data((0..<PairingCrypto.sidLength).map { _ in UInt8.random(in: 0...255) })
    /// How long the demo Mac waits before it approves, so the code is on screen for a moment.
    let approvalDelay: Duration = .seconds(2)

    var offer: PairingOffer { PairingOffer(sid: sid, macPublic: keypair.publicKey, addrs: ["192.168.1.20"], port: 49152) }
    var connector: PairingConnector { { [self] _, _ in DemoMacTransport(mac: self) } }

    static let bundleJSON = #"""
    {"v":1,"createdAt":1790000000000,"device":{"name":"Demo MacBook Pro"},
     "accounts":[
      {"email":"demo.work@example.com","name":"Demo Work","provider":"imap","authKind":"password","username":"demo.work@example.com",
       "imap":{"host":"imap.example.com","port":993,"secure":true},"smtp":{"host":"smtp.example.com","port":465,"secure":true},
       "aliases":["demo@example.com"],"showInUnified":true,"sortOrder":0,"password":"demo-app-password"},
      {"email":"demo.home@gmail.com","name":"Demo Home","provider":"gmail","authKind":"oauth_google","username":"demo.home@gmail.com",
       "imap":{"host":"imap.gmail.com","port":993,"secure":true},"smtp":{"host":"smtp.gmail.com","port":465,"secure":true},
       "aliases":[],"showInUnified":true,"sortOrder":1}],
     "signatures":[{"name":"Work","html":"<p>Demo</p>","accountEmails":["demo.work@example.com"],"defaultNew":true,"defaultReply":false}],
     "templates":[{"name":"Thanks","subject":"Thank you","html":"<p>Thank you.</p>"},{"name":"Follow up","subject":"Following up","html":"<p>Checking in.</p>"}],
     "rules":[{"name":"Receipts","enabled":true,"accountEmail":null,"match":"any","sortOrder":0,"conditions":[{"field":"from","op":"contains","value":"receipts@"}],"actions":[{"type":"category","category":"notifications"}]}],
     "blockedSenders":["spam.example"],
     "settings":{"compose":{"undoSendSeconds":10},"inbox":{"focused":true}}}
    """#
}

private final class DemoMacTransport: PairingTransport, @unchecked Sendable {
    private let mac: DemoMac
    private let stream: AsyncStream<Data>
    private let continuation: AsyncStream<Data>.Continuation
    private var iterator: AsyncStream<Data>.Iterator
    private let lock = NSLock()
    private var decoder = FrameDecoder()
    private var sealer: FrameSealer?
    private var approval: Task<Void, Never>?

    init(mac: DemoMac) {
        self.mac = mac
        (stream, continuation) = AsyncStream<Data>.makeStream()
        iterator = stream.makeAsyncIterator()
    }

    func send(_ data: Data) async throws {
        let frames = lock.withLock { try? decoder.push(data) } ?? []
        guard let hello = frames.first(where: { $0.type == PairingFrameType.hello }) else { return }
        guard let object = try? JSONSerialization.jsonObject(with: hello.body) as? [String: Any],
              let text = object["pk"] as? String, let phonePublic = Data(base64URL: text),
              let shared = try? PairingCrypto.sharedSecret(privateKey: mac.keypair.privateKey, peerPublic: phonePublic) else { throw PairingError.weakKey }
        let keys = PairingCrypto.deriveSession(shared: shared, sid: mac.sid, macPublic: mac.keypair.publicKey, phonePublic: phonePublic)
        let sealer = FrameSealer(key: keys.macToPhone, sid: mac.sid, direction: .macToPhone)
        approval = Task { [mac, continuation] in
            try? await Task.sleep(for: mac.approvalDelay)
            var sealer = sealer
            guard !Task.isCancelled, let frames = try? Self.bundleFrames(sealer: &sealer) else { return }
            for frame in frames { continuation.yield(frame) }
        }
    }

    func receive() async throws -> Data {
        var local = iterator
        guard let next = await local.next() else { throw PairingError.connectionClosed }
        iterator = local
        return next
    }

    func close() {
        approval?.cancel()
        continuation.finish()
    }

    private static func bundleFrames(sealer: inout FrameSealer) throws -> [Data] {
        var out = [try encodeFrame(type: PairingFrameType.ready, body: try sealer.seal(type: PairingFrameType.ready, plaintext: Data()))]
        let json = Data(DemoMac.bundleJSON.utf8)
        var offset = 0
        repeat {
            let end = min(offset + PairingLimits.chunkSize, json.count)
            let plain = Data([end >= json.count ? 1 : 0]) + json[offset..<end]
            out.append(try encodeFrame(type: PairingFrameType.bundle, body: try sealer.seal(type: PairingFrameType.bundle, plaintext: plain)))
            offset = end
        } while offset < json.count
        return out
    }
}

/// Accounts and library for the demo pairing, kept in memory so nothing reaches the network or the demo mailbox.
actor DemoImportTarget: ImportTarget {
    private var stored: [Account] = []
    private var next = 1

    func accounts() async throws -> [Account] { stored }

    func addAccount(_ input: AddAccountInput) async throws -> Account {
        try append(email: input.email, name: input.name, provider: input.provider ?? .imap, kind: .password, server: input.server)
    }

    func addGoogleAccount(loginHint: String?) async throws -> Account {
        try append(email: loginHint ?? "demo@gmail.com", name: "Demo", provider: .gmail, kind: .oauthGoogle, server: nil)
    }

    func updateAccount(id: AccountID, _ patch: AccountPatch) async throws -> Account {
        guard let i = stored.firstIndex(where: { $0.id == id }) else { throw FlintError(.notFound, "That account isn't here.") }
        if let name = patch.name { stored[i].name = name }
        return stored[i]
    }

    func saveSignature(_ signature: Signature) async throws {}
    func saveTemplate(_ template: Template) async throws {}
    func saveRule(_ rule: Rule) async throws {}
    func blockSender(_ pattern: String) async throws {}
    func applySettings(patch: JSONValue) async throws {}

    private func append(email: String, name: String, provider: MailProvider, kind: AuthKind, server: ServerConfig?) throws -> Account {
        let config = server ?? ServerConfig(imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, username: email)
        let account = Account(id: "demo\(next)", email: email, name: name, provider: provider, authKind: kind, server: config)
        next += 1
        stored.append(account)
        return account
    }
}

struct DemoPairingServices: PairingServices {
    let mac = DemoMac()
    let target = DemoImportTarget()

    var deviceName: String { ThisDevice.name }
    var offersDemoMac: Bool { true }
    var demoOffer: PairingOffer? { mac.offer }
    func makeClient(offer: PairingOffer) -> PairingClient { PairingClient(offer: offer, deviceName: deviceName, connector: mac.connector) }
    func importer() -> BundleImporter { BundleImporter(target: target) }
    func rememberPairing(macName: String) {}
}

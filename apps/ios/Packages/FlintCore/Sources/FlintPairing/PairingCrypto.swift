// X25519 key agreement, HKDF-SHA256 and ChaCha20-Poly1305 framing for "Set up from your Mac"
// (docs/ios/DESIGN-NOTES.md section 7). Reproduces packages/core/fixtures/pairing-vectors.json byte for byte.

import CryptoKit
import Foundation

public enum PairingDirection: UInt8, Sendable {
    case macToPhone = 1
    case phoneToMac = 2
}

public struct PairingKeypair: Sendable {
    public let privateKey: Data
    public let publicKey: Data

    public static func generate() -> PairingKeypair {
        let key = Curve25519.KeyAgreement.PrivateKey()
        return PairingKeypair(privateKey: key.rawRepresentation, publicKey: key.publicKey.rawRepresentation)
    }

    /// For test vectors.
    public init(privateKey: Data) throws {
        let key = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateKey)
        self.privateKey = privateKey
        self.publicKey = key.publicKey.rawRepresentation
    }

    private init(privateKey: Data, publicKey: Data) {
        self.privateKey = privateKey
        self.publicKey = publicKey
    }
}

public struct PairingSessionKeys: Sendable {
    public let macToPhone: SymmetricKey
    public let phoneToMac: SymmetricKey
    /// Six digits, zero padded, no separator.
    public let sas: String

    /// "482913" shown as "482 913".
    public var displaySAS: String { PairingCrypto.format(sas: sas) }
}

public enum PairingCrypto {
    public static let keyLength = 32
    public static let sidLength = 16
    public static let tagLength = 16
    public static let protocolVersion = 1

    private static let infoKeys = Data("flint-pair/v1".utf8)
    private static let infoSAS = Data("flint-pair/sas".utf8)

    /// The raw X25519 shared secret. Throws `weakKey` for a wrong-sized key or a low-order point.
    public static func sharedSecret(privateKey: Data, peerPublic: Data) throws -> Data {
        guard privateKey.count == keyLength, peerPublic.count == keyLength else { throw PairingError.weakKey }
        do {
            let mine = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateKey)
            let theirs = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: peerPublic)
            let secret = try mine.sharedSecretFromKeyAgreement(with: theirs).withUnsafeBytes { Data($0) }
            guard secret.contains(where: { $0 != 0 }) else { throw PairingError.weakKey }
            return secret
        } catch {
            throw PairingError.weakKey
        }
    }

    public static func deriveSession(shared: Data, sid: Data, macPublic: Data, phonePublic: Data) -> PairingSessionKeys {
        let ikm = SymmetricKey(data: shared)
        let material = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: sid, info: infoKeys + macPublic + phonePublic, outputByteCount: 64)
        let bytes = material.withUnsafeBytes { Data($0) }
        let sasBytes = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: sid, info: infoSAS, outputByteCount: 4).withUnsafeBytes { Data($0) }
        let number = sasBytes.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) } % 1_000_000
        return PairingSessionKeys(
            macToPhone: SymmetricKey(data: bytes.prefix(32)), phoneToMac: SymmetricKey(data: bytes.suffix(32)),
            sas: String(format: "%06u", number))
    }

    public static func format(sas: String) -> String { sas.count == 6 ? "\(sas.prefix(3)) \(sas.suffix(3))" : sas }

    /// 4 zero bytes then the counter as a 64-bit big-endian integer.
    public static func nonce(counter: UInt64) -> Data {
        var data = Data(count: 4)
        for shift in stride(from: 56, through: 0, by: -8) { data.append(UInt8((counter >> UInt64(shift)) & 0xff)) }
        return data
    }

    static func aad(sid: Data, direction: PairingDirection, type: UInt8) -> Data { sid + Data([direction.rawValue, type]) }

    /// Ciphertext followed by the 16-byte tag.
    public static func seal(key: SymmetricKey, sid: Data, direction: PairingDirection, type: UInt8, counter: UInt64, plaintext: Data) throws -> Data {
        let box = try ChaChaPoly.seal(plaintext, using: key, nonce: ChaChaPoly.Nonce(data: nonce(counter: counter)), authenticating: aad(sid: sid, direction: direction, type: type))
        return box.ciphertext + box.tag
    }

    /// Throws `tampered` when the tag does not verify (modified data, wrong key, counter, direction, type or session).
    public static func open(key: SymmetricKey, sid: Data, direction: PairingDirection, type: UInt8, counter: UInt64, sealed: Data) throws -> Data {
        guard sealed.count >= tagLength else { throw PairingError.tampered }
        let body = Data(sealed)
        do {
            let box = try ChaChaPoly.SealedBox(
                nonce: ChaChaPoly.Nonce(data: nonce(counter: counter)), ciphertext: body.prefix(body.count - tagLength), tag: body.suffix(tagLength))
            return try ChaChaPoly.open(box, using: key, authenticating: aad(sid: sid, direction: direction, type: type))
        } catch {
            throw PairingError.tampered
        }
    }
}

/// Seals frames in one direction, counting up from zero.
public struct FrameSealer: Sendable {
    private let key: SymmetricKey
    private let sid: Data
    private let direction: PairingDirection
    private var counter: UInt64 = 0

    public init(key: SymmetricKey, sid: Data, direction: PairingDirection) {
        self.key = key
        self.sid = sid
        self.direction = direction
    }

    public mutating func seal(type: UInt8, plaintext: Data) throws -> Data {
        let sealed = try PairingCrypto.seal(key: key, sid: sid, direction: direction, type: type, counter: counter, plaintext: plaintext)
        counter += 1
        return sealed
    }
}

/// Opens frames in one direction. The counter moves only after a frame verifies, so a replayed, reordered or dropped frame fails.
public struct FrameOpener: Sendable {
    private let key: SymmetricKey
    private let sid: Data
    private let direction: PairingDirection
    private var counter: UInt64 = 0

    public init(key: SymmetricKey, sid: Data, direction: PairingDirection) {
        self.key = key
        self.sid = sid
        self.direction = direction
    }

    public mutating func open(type: UInt8, sealed: Data) throws -> Data {
        let plain = try PairingCrypto.open(key: key, sid: sid, direction: direction, type: type, counter: counter, sealed: sealed)
        counter += 1
        return plain
    }
}

extension Data {
    /// Strict unpadded base64url. Nil for any other character.
    public init?(base64URL text: String) {
        guard text.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { return nil }
        var s = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        s += String(repeating: "=", count: (4 - s.count % 4) % 4)
        self.init(base64Encoded: s)
    }

    public var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

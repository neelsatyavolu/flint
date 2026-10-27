// Wire framing: 4-byte big-endian length (type byte plus body), 1 type byte, body. At most 64 KiB per frame.

import Foundation

public enum PairingFrameType {
    public static let hello: UInt8 = 0x01
    public static let ready: UInt8 = 0x02
    /// Sealed plaintext: a flag byte (0 more, 1 last) then up to `chunkSize` bytes of bundle JSON.
    public static let bundle: UInt8 = 0x03
    public static let ack: UInt8 = 0x04
}

public enum PairingLimits {
    public static let maxFrame = 64 * 1024
    public static let chunkSize = 32 * 1024
    public static let maxBundleBytes = 2 * 1024 * 1024
}

public struct PairingFrame: Equatable, Sendable {
    public let type: UInt8
    public let body: Data
}

public func encodeFrame(type: UInt8, body: Data) throws -> Data {
    let length = 1 + body.count
    guard length <= PairingLimits.maxFrame else { throw PairingError.badFrame }
    var out = Data()
    for shift in stride(from: 24, through: 0, by: -8) { out.append(UInt8((UInt32(length) >> UInt32(shift)) & 0xff)) }
    out.append(type)
    out.append(body)
    return out
}

/// Collects socket reads into whole frames. A zero or oversize length throws before any body is buffered.
public struct FrameDecoder: Sendable {
    private var buffer = Data()

    public init() {}

    public mutating func push(_ data: Data) throws -> [PairingFrame] {
        buffer.append(data)
        var frames: [PairingFrame] = []
        while buffer.count >= 4 {
            let b = Array(buffer.prefix(4))
            let length = Int(b[0]) << 24 | Int(b[1]) << 16 | Int(b[2]) << 8 | Int(b[3])
            guard length >= 1, length <= PairingLimits.maxFrame else { throw PairingError.badFrame }
            guard buffer.count >= 4 + length else { break }
            let frame = buffer.subdata(in: buffer.startIndex + 4..<buffer.startIndex + 4 + length)
            frames.append(PairingFrame(type: frame[frame.startIndex], body: frame.dropFirst()))
            buffer = buffer.subdata(in: buffer.startIndex + 4 + length..<buffer.endIndex)
        }
        return frames
    }
}

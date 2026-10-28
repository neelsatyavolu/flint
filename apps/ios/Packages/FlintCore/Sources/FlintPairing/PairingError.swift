// Everything that can go wrong while pairing, with the sentence the screen shows. No case carries a key, a code, or bundle content.

import Foundation

public enum PairingError: Error, Equatable, Sendable, LocalizedError {
    case badQRCode
    case unreachable
    case localNetworkDenied
    case connectionClosed
    case timedOut
    case badFrame
    case tampered
    case unexpectedFrame
    case weakKey
    case bundleTooLarge
    case malformedBundle
    case unsupportedVersion

    /// Plain sentence case, no exclamation marks (DESIGN.md section 8).
    public var errorDescription: String? {
        switch self {
        case .badQRCode: "That isn't a Flint pairing code. Open Settings > Devices on your Mac and scan the code shown there."
        case .unreachable: "Couldn't reach your Mac. Check that both devices are on the same Wi-Fi."
        case .localNetworkDenied: "Flint needs local network access to reach your Mac. Turn it on in Settings > Privacy & Security > Local Network."
        case .connectionClosed: "The pairing ended. Start again from your Mac."
        case .timedOut: "Your Mac didn't answer in time. Start again from your Mac."
        case .badFrame, .unexpectedFrame: "Your Mac sent something Flint didn't understand. Start again."
        case .tampered: "The data from your Mac didn't check out, so Flint stopped. Start again."
        case .weakKey: "Your Mac sent an unsafe key, so Flint stopped. Start again."
        case .bundleTooLarge, .malformedBundle: "The settings from your Mac couldn't be read. Update Flint on both devices and try again."
        case .unsupportedVersion: "Your Mac uses a newer pairing version. Update Flint on this iPhone."
        }
    }
}

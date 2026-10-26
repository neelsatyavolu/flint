import LocalAuthentication

/// How a request for the device owner (Face ID, Touch ID or the passcode) ended.
enum AuthOutcome: Equatable, Sendable {
    case success
    /// The person cancelled or failed.
    case failed
    /// The device has no passcode, so there is no owner to ask. The lock lets the app open rather than lock the person out.
    case unavailable
}

enum DeviceAuthentication {
    /// Face ID (or Touch ID) with the device passcode as the fallback.
    static func authenticate(reason: String) async -> AuthOutcome {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { return .unavailable }
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) ? .success : .failed
        } catch {
            return .failed
        }
    }
}

/// Checks and asks for Face ID (or the passcode) before the lock is turned on, so a person cannot lock themselves out.
enum FaceIDLock {
    static func isAvailable() -> Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    static func confirm(reason: String) async -> Bool {
        await DeviceAuthentication.authenticate(reason: reason) == .success
    }
}

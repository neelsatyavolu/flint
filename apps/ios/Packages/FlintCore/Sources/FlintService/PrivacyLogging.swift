// swift-log is process-global and SwiftMail writes hosts, user names and IMAP commands to it at info level. The app calls
// `FlintLogging.bootstrap()` once, before any transport exists, so none of that can reach a log: everything below warning is
// dropped and warnings and errors keep only their level and logger label, never the message or metadata.

import Foundation
import Logging
import os.log
import Synchronization

public struct PrivacyLogHandler: LogHandler {
    public var logLevel: Logging.Logger.Level
    /// Metadata is never kept, so setting it does nothing.
    public var metadata: Logging.Logger.Metadata {
        get { [:] }
        set {}
    }
    private let label: String
    private let sink: @Sendable (String) -> Void

    public init(label: String, minimumLevel: Logging.Logger.Level = .warning, sink: @escaping @Sendable (String) -> Void) {
        self.label = label
        self.logLevel = minimumLevel
        self.sink = sink
    }

    public subscript(metadataKey key: String) -> Logging.Logger.Metadata.Value? {
        get { nil }
        set {}
    }

    public func log(event: LogEvent) {
        guard event.level >= logLevel else { return }
        sink("\(event.level) \(label)")
    }
}

public enum FlintLogging {
    private static let bootstrapped = Mutex(false)

    /// Installs the privacy-safe handler. Safe to call more than once; only the first call has an effect.
    public static func bootstrap() {
        let first = bootstrapped.withLock { done in
            defer { done = true }
            return !done
        }
        guard first else { return }
        let osLog = os.Logger(subsystem: "co.xanom.flint", category: "mail")
        LoggingSystem.bootstrap { label in
            PrivacyLogHandler(label: label, sink: { line in osLog.warning("\(line, privacy: .public)") })
        }
    }
}

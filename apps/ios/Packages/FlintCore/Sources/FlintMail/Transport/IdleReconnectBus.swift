import Foundation
import Synchronization

/// SwiftMail's IDLE runner redials a dropped connection on its own and tells nobody: the stream stays open and mail that landed
/// while it redialed is not pushed. The only trace is an info line from its cycle logger, so the privacy log handler
/// (`PrivacyLogHandler`) forwards that one line here, content free, and every `SwiftMailTransport.idle` stream turns it into
/// `IdleEvent.reconnected`. The signal carries no host, user or mailbox: a reconnect on another account wakes this one too,
/// which costs one cheap sync and is simpler than matching connections.
///
/// Without the handler installed (a host that did not call `FlintLogging.bootstrap()`) no signal arrives and the safety poll
/// stays the fallback. The line is SwiftMail's at the pinned revision; `IdleReconnectBusTests` and the GreenMail test pin it.
public enum IdleReconnectBus {
    public static let loggerLabelPrefix = "com.cocoanetics.SwiftMail.IdleCycle."
    static let reconnectMarker = "Reconnected IDLE session"

    private static let listeners = Mutex<[UUID: AsyncStream<Void>.Continuation]>([:])

    /// True for the cycle logger's "reconnected" line. The message is read, never stored or forwarded.
    public static func isReconnect(label: String, message: String) -> Bool {
        label.hasPrefix(loggerLabelPrefix) && message.contains(reconnectMarker)
    }

    /// Tells every open stream a reconnect happened.
    public static func report() {
        let current = listeners.withLock { Array($0.values) }
        for continuation in current { continuation.yield() }
    }

    /// A stream that yields once per reconnect until the consumer stops.
    static func stream() -> AsyncStream<Void> {
        let id = UUID()
        return AsyncStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            listeners.withLock { $0[id] = continuation }
            continuation.onTermination = { _ in listeners.withLock { $0[id] = nil } }
        }
    }
}

import FlintModel

/// A follow-up reminder is measured from the moment it is chosen. A message that goes out later must not be reminded about
/// before it is sent, so the wait is kept and counted from the send time.
enum ReminderTiming {
    /// The time the reminder should fire for a message sent at `sendAt` (nil: sent after the undo window), chosen at `now`.
    static func effective(remindAt: EpochMs, sendAt: EpochMs?, now: EpochMs) -> EpochMs {
        guard let sendAt, remindAt <= sendAt else { return remindAt }
        return sendAt + max(remindAt - now, 0)
    }
}

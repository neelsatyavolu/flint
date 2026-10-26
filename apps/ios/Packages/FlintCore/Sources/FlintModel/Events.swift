// FROZEN CONTRACT (Wave 1, track 1B). Mirrors packages/core/src/types.ts.
// Changing this file needs the wave lead's sign-off and a note in docs/ios/HANDOFF.md.

import Foundation

/// Mirrors the TypeScript `FlintEvent` union minus the desktop-only cases (agent activity, AI streaming).
/// The service publishes these on its event bus; UI and background code subscribe.
public enum FlintEvent: Hashable, Sendable {
    case sync(SyncStatus)
    /// Lists and the sidebar should refetch.
    case mailChanged(accountId: AccountID, threadIds: [ThreadID])
    /// `snippet`: first line of the body when known. `forced`: a rule asked for an alert.
    case newMail(accountId: AccountID, threadId: ThreadID, from: Address, subject: String, category: MailCategory, snippet: String?, forced: Bool)
    case receipt(trackedId: Int, email: String, status: ReceiptStatus, at: EpochMs)
    case send(ScheduledSend)
    case settings(Settings)
    /// A new verification code was detected. The UI shows it.
    case code(VerificationCode)
    case toast(ToastLevel, message: String, undoToken: String?)
}

public enum ToastLevel: String, Codable, Hashable, Sendable {
    case info, error
}

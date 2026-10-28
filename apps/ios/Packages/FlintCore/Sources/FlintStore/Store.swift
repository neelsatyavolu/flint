// FROZEN CONTRACT (Wave 1, track 1B). The persistence surface the mail engine, classifiers and service use.
// Mirrors the repositories behind `Store` in packages/core/src/store (same method meanings, camelCase).
// Track 2A implements it with GRDB (`DatabasePool`, WAL, FTS5). Methods are async and throw `FlintError`
// (`.notFound` for missing rows, `.invalid` for bad input). Every method is safe to call from any task.
// Atomic multi-step work is the implementation's job (one write transaction per method); callers never see a transaction.

import FlintModel
import Foundation

public protocol AccountsRepository: Sendable {
    func accountHasMessages(_ id: AccountID) async throws -> Bool
    func createAccount(_ input: NewAccount) async throws -> Account
    func account(id: AccountID) async throws -> Account?
    func account(email: String) async throws -> Account?
    func listAccounts() async throws -> [Account]
    func updateAccount(_ id: AccountID, _ patch: AccountPatch) async throws -> Account
    /// Removes the account and everything stored for it.
    func deleteAccount(_ id: AccountID) async throws
    /// Lower-cased addresses and aliases of every account.
    func ownAddresses() async throws -> Set<String>
}

public protocol FoldersRepository: Sendable {
    func upsertFolder(_ accountId: AccountID, _ input: FolderInput) async throws -> Folder
    func folder(id: FolderID) async throws -> Folder?
    func folder(accountId: AccountID, path: String) async throws -> Folder?
    func folder(accountId: AccountID, role: MailboxRole) async throws -> Folder?
    /// Finds the folder with this role or creates the conventional one.
    func ensureFolder(accountId: AccountID, role: MailboxRole) async throws -> Folder
    func listFolders(accountId: AccountID) async throws -> [Folder]
    func folderSyncState(_ folderId: FolderID) async throws -> FolderSyncState
    func setFolderSyncState(_ folderId: FolderID, _ patch: FolderSyncPatch) async throws
    /// UIDVALIDITY changed: drops the folder's messages and sync state. Returns the threads that changed.
    func resetFolder(_ folderId: FolderID) async throws -> [ThreadID]
}

public protocol IngestRepository: Sendable {
    /// Stores messages, resolves threads (merging where headers connect them), categorizes, evaluates rules and blocks.
    func ingestMessages(_ accountId: AccountID, _ folderId: FolderID, _ items: [IngestMessage], context: IngestContext) async throws -> [IngestOutcome]
    func setBody(_ messageRowId: MessageRowID, _ body: MessageBody) async throws
    /// Returns the threads whose flags changed.
    func applyFlags(_ folderId: FolderID, _ updates: [FlagUpdate]) async throws -> [ThreadID]
    /// Gmail: replaces label membership (labels as folder paths).
    func applyGmailLabels(_ folderId: FolderID, _ updates: [(uid: Int, labels: [String])]) async throws -> [ThreadID]
    func removeUids(_ folderId: FolderID, _ uids: [Int]) async throws -> [ThreadID]
    func listLocalUids(_ folderId: FolderID, minUid: Int) async throws -> [Int]
}

public protocol MessagesRepository: Sendable {
    func message(id: MessageRowID) async throws -> StoredMessage?
    func messages(accountId: AccountID, messageId: String) async throws -> [StoredMessage]
    func message(folderId: FolderID, uid: Int) async throws -> StoredMessage?
    func attachment(id: Int) async throws -> StoredAttachment?
    func setAttachmentCachedPath(_ id: Int, _ path: String?) async throws
    func messageLocations(_ ids: [MessageRowID]) async throws -> [MessageLocation]
    func threadLocations(_ threadIds: [ThreadID]) async throws -> [MessageLocation]
    func threadRows(_ threadId: ThreadID) async throws -> ThreadRows?
}

public protocol ThreadsRepository: Sendable {
    /// Search text is parsed by the store (operators from:, to:, cc:, subject:, has:attachment, is:unread, is:read, is:pinned,
    /// is:snoozed, in:, before:, after:, account:, quotes, negation, prefix on the last word).
    func listThreads(_ query: ThreadQuery, now: EpochMs) async throws -> ThreadPage
    func threadItems(_ ids: [ThreadID]) async throws -> [ThreadListItem]
    func sidebarData(now: EpochMs) async throws -> SidebarData

    func snapshotThreads(_ threadIds: [ThreadID]) async throws -> ThreadSnapshot
    func restoreSnapshot(_ snapshot: ThreadSnapshot) async throws -> [ThreadID]
    func markRead(_ threadIds: [ThreadID], read: Bool) async throws -> ActionResult
    func setPinned(_ threadIds: [ThreadID], pinned: Bool) async throws -> ActionResult
    func setMuted(_ threadIds: [ThreadID], muted: Bool) async throws -> ActionResult
    func snooze(_ threadIds: [ThreadID], until: EpochMs) async throws -> ActionResult
    func unsnooze(_ threadIds: [ThreadID]) async throws -> ActionResult
    func listDueSnoozes(now: EpochMs) async throws -> [ThreadID]
    func wakeSnoozed(_ threadId: ThreadID, now: EpochMs) async throws -> ActionResult
    func resurface(_ threadId: ThreadID, now: EpochMs) async throws
    func moveThreads(_ threadIds: [ThreadID], to target: MoveTarget) async throws -> ActionResult
    /// After the server move, records the message's new folder and UID.
    func relocateMessage(_ messageRowId: MessageRowID, folderId: FolderID, uid: Int) async throws

    func pinCategory(_ threadIds: [ThreadID], _ category: MailCategory, source: CategorySource) async throws
    /// Re-runs the categorizer over stored mail. Returns how many messages changed.
    func recategorizeAll() async throws -> Int
    func headerRefreshTargets(accountId: AccountID, sinceMs: EpochMs) async throws -> [HeaderRefreshTarget]
    func mergeHeaders(_ folderId: FolderID, _ items: [(uid: Int, headers: [String: String])]) async throws -> Int
}

public protocol DraftsRepository: Sendable {
    func createDraft(_ input: NewDraft, now: EpochMs) async throws -> Draft
    func draft(id: Int) async throws -> Draft?
    func updateDraft(_ id: Int, _ patch: DraftPatch, now: EpochMs) async throws -> Draft
    func deleteDraft(_ id: Int) async throws
    func listDrafts() async throws -> [Draft]
    func findDraft(accountId: AccountID, serverMessageId: String?, folderId: FolderID, uid: Int) async throws -> Draft?
    func listDrafts(threadId: ThreadID) async throws -> [Draft]
    func draftMeta(_ id: Int) async throws -> DraftMeta
    func setDraftMeta(_ id: Int, _ meta: DraftMeta) async throws
}

public protocol ScheduledSendRepository: Sendable {
    func createScheduledSend(_ input: NewScheduledSend, now: EpochMs) async throws -> ScheduledSend
    func scheduledSend(id: Int) async throws -> ScheduledSend?
    func listDueScheduled(now: EpochMs) async throws -> [ScheduledSend]
    func nextScheduledAt() async throws -> EpochMs?
    func listScheduled() async throws -> [ScheduledSend]
    func openScheduledSend(draftId: Int) async throws -> ScheduledSend?
    func updateScheduled(_ id: Int, _ patch: ScheduledSendPatch) async throws -> ScheduledSend
}

public protocol RemindersRepository: Sendable {
    func createReminder(accountId: AccountID, threadId: ThreadID?, messageId: String, remindAt: EpochMs) async throws -> Reminder
    func reminder(id: Int) async throws -> Reminder?
    func listDueReminders(now: EpochMs) async throws -> [Reminder]
    func nextReminderAt() async throws -> EpochMs?
    func listPendingReminders(limit: Int) async throws -> [Reminder]
    func setReminderStatus(_ id: Int, _ status: ReminderStatus) async throws
    func cancelReminders(accountId: AccountID, messageId: String) async throws
    func threadHasReply(_ threadId: ThreadID, since: EpochMs) async throws -> Bool
}

public protocol LibraryRepository: Sendable {
    func listSignatures() async throws -> [Signature]
    func signature(id: Int) async throws -> Signature?
    /// `id` nil creates; otherwise replaces.
    func saveSignature(_ signature: Signature, now: EpochMs) async throws -> Signature
    func deleteSignature(_ id: Int) async throws
    func listTemplates() async throws -> [Template]
    func template(id: Int) async throws -> Template?
    func saveTemplate(_ template: Template, now: EpochMs) async throws -> Template
    func deleteTemplate(_ id: Int) async throws
}

public protocol RulesRepository: Sendable {
    func listRules() async throws -> [Rule]
    func rule(id: Int) async throws -> Rule?
    /// Enabled rules that apply to the account (its own and the all-accounts ones), in order.
    func listRules(accountId: AccountID) async throws -> [Rule]
    func saveRule(_ rule: Rule) async throws -> Rule
    func deleteRule(_ id: Int) async throws
    /// Normalizes and stores an address or domain pattern. Returns the stored pattern.
    func blockSender(_ input: String) async throws -> String
    func unblockSender(_ input: String) async throws -> String?
    func listBlocked() async throws -> [BlockedSender]
    func blockedPatterns() async throws -> Set<String>
}

public protocol ContactsRepository: Sendable {
    func touchReceived(_ address: Address, date: EpochMs) async throws
    func touchSent(_ address: Address, date: EpochMs) async throws
    func hasSentTo(_ address: String) async throws -> Bool
    func suggestContacts(prefix: String, limit: Int) async throws -> [Contact]
}

public protocol SettingsRepository: Sendable {
    func settings() async throws -> Settings
    /// Deep-merges a partial JSON patch (see `Settings.merging`), validates, stores and returns the result.
    func updateSettings(_ patch: JSONValue) async throws -> Settings
}

public protocol KeyValueRepository: Sendable {
    func kvGet(_ key: String, now: EpochMs) async throws -> String?
    func kvSet(_ key: String, _ value: String, ttlMs: Int?, now: EpochMs) async throws
    func kvDelete(_ key: String) async throws
    func kvPurgeExpired(now: EpochMs) async throws -> Int
}

public protocol PendingOpsRepository: Sendable {
    func addPendingOp(accountId: AccountID, _ op: PendingOpSpec, messageIds: [MessageRowID], now: EpochMs) async throws -> Int
    func removePendingOp(_ id: Int) async throws
    /// Records a failed replay and returns the attempts so far.
    func bumpPendingOp(_ id: Int, error: String) async throws -> Int
    func listPendingOps() async throws -> [PendingOp]
}

public protocol ReceiptsRepository: Sendable {
    func createTracked(_ input: NewTracked) async throws -> Int
    func linkSentMessage(accountId: AccountID, ref: String?, messageId: String, threadId: ThreadID) async throws
    func setTrackedState(_ trackedId: Int, _ state: NewTracked.State) async throws
    func findTracked(ref: String) async throws -> Int?
    func findTracked(accountId: AccountID, messageId: String) async throws -> Int?
    func listPollable(sinceMs: EpochMs) async throws -> [PollableTracked]
    func tracked(id: Int) async throws -> TrackedMessage?
    func listTracked(limit: Int?, unopenedOnly: Bool?) async throws -> [TrackedMessage]
    func receiptDetail(trackedId: Int) async throws -> ReceiptDetail
    func receiptDetail(accountId: AccountID, messageId: String) async throws -> ReceiptDetail?
    func ingestReceiptEvents(_ events: [ReceiptEventInput], now: EpochMs) async throws -> [ReceiptChange]
    func recomputeReceipts(threadId: ThreadID, now: EpochMs) async throws -> [ReceiptChange]
}

/// Everything the app persists. `GRDBStore` (track 2A) is the production conformance; tests may fake any slice.
public protocol Store:
    AccountsRepository, FoldersRepository, IngestRepository, MessagesRepository, ThreadsRepository, DraftsRepository,
    ScheduledSendRepository, RemindersRepository, LibraryRepository, RulesRepository, ContactsRepository,
    SettingsRepository, KeyValueRepository, PendingOpsRepository, ReceiptsRepository {}

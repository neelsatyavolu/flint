import FlintModel
import FlintStore
import Foundation
@testable import FlintMail

// In-memory stand-in for the repositories the mail engine uses (the GRDB store is track 2A's). It keeps real folder, sync
// state and message rows so the engine can be exercised end to end against `FakeMailTransport`; thread-level local actions
// (move, mark read, pin) are scripted by the tests.

func mailUnused(_ name: String = #function) -> Never { fatalError("MailTestStore.\(name) is not used by the mail engine tests") }

actor MailTestStore: AccountsRepository, FoldersRepository, IngestRepository, SettingsRepository, MessagesRepository, ThreadsRepository, PendingOpsRepository,
    DraftsRepository, ScheduledSendRepository, RemindersRepository, ReceiptsRepository {
    var accountsByID: [AccountID: Account] = [:]
    var folders: [Folder] = []
    var syncStates: [FolderID: FolderSyncState] = [:]
    var messages: [MessageRowID: StoredMessage] = [:]
    var members: [MessageRowID: Set<FolderID>] = [:]
    var providers: [AccountID: MailProvider] = [:]
    var pendingOps: [PendingOp] = []
    var settingsValue = Settings()

    private var nextFolderID = 1
    private var nextMessageID = 1
    private var nextThreadID = 1
    private var nextOpID = 1

    // Scripting and observation
    var blockedFrom: Set<String> = []
    var ruleActionsByMessageId: [String: [RuleAction]] = [:]
    var ownAddresses: Set<String> = []
    /// Results handed out, in order, by `moveThreads`, `markRead` and `setPinned`.
    var scriptedResults: [ActionResult] = []
    var movedTargets: [MoveTarget] = []
    var markedRead: [(ids: [ThreadID], read: Bool)] = []
    var pinned: [(ids: [ThreadID], pinned: Bool)] = []
    var restoredSnapshots: [ThreadSnapshot] = []
    var relocations: [(row: MessageRowID, folder: FolderID, uid: Int)] = []
    var removedUids: [(folder: FolderID, uids: [Int])] = []
    var resetFolders: [FolderID] = []
    var bodiesSet: [MessageRowID: MessageBody] = [:]
    var threadMuted: Set<ThreadID> = []
    var listLocalUidsCalls = 0

    // Drafts, scheduled sends, reminders, receipts and snoozes
    var drafts: [Int: Draft] = [:]
    var draftMetas: [Int: DraftMeta] = [:]
    var scheduled: [Int: ScheduledSend] = [:]
    var reminders: [Int: Reminder] = [:]
    var repliedThreads: Set<ThreadID> = []
    var snoozedUntil: [ThreadID: EpochMs] = [:]
    var resurfaced: [ThreadID] = []
    var trackedStates: [Int: NewTracked.State] = [:]
    var trackedRefs: [String: Int] = [:]
    var linkedSent: [(ref: String?, messageId: String, threadId: ThreadID)] = []
    private var nextDraftID = 1
    private var nextScheduledID = 1
    private var nextReminderID = 1
    func nextDraftIDValue() -> Int { defer { nextDraftID += 1 }; return nextDraftID }
    func nextScheduledIDValue() -> Int { defer { nextScheduledID += 1 }; return nextScheduledID }
    func nextReminderIDValue() -> Int { defer { nextReminderID += 1 }; return nextReminderID }
    func setDraftValue(_ draft: Draft, meta: DraftMeta) { drafts[draft.id] = draft; draftMetas[draft.id] = meta }
    func addDraft(_ draft: Draft, meta: DraftMeta = DraftMeta()) { drafts[draft.id] = draft; draftMetas[draft.id] = meta; nextDraftID = max(nextDraftID, draft.id + 1) }
    func registerTracked(ref: String, id: Int) { trackedRefs[ref] = id }

    // MARK: Setup helpers

    func addAccount(_ account: Account) { accountsByID[account.id] = account; providers[account.id] = account.provider }

    func setSettings(_ value: Settings) { settingsValue = value }
    func setBlocked(_ addresses: Set<String>) { blockedFrom = addresses }
    func setRuleActions(_ actions: [RuleAction], for messageId: String) { ruleActionsByMessageId[messageId] = actions }
    func setOwnAddresses(_ addresses: Set<String>) { ownAddresses = addresses }
    func script(_ results: [ActionResult]) { scriptedResults = results }

    func folderID(_ path: String, account: AccountID = "a1") -> FolderID? {
        folders.first { $0.accountId == account && $0.path == path }?.id
    }

    func allMessages(in folderId: FolderID) -> [StoredMessage] {
        messages.values.filter { $0.folderId == folderId }.sorted { $0.uid < $1.uid }
    }

    func messageCount() -> Int { messages.count }

    func membership(of row: MessageRowID) -> Set<FolderID> { members[row] ?? [] }

    func setMessageFlag(row: MessageRowID, seen: Bool) { messages[row]?.seen = seen }

    func listLocalUidsCount() -> Int { listLocalUidsCalls }

    func setReplied(_ thread: ThreadID) { repliedThreads.insert(thread) }
    func snoozeThread(_ thread: ThreadID, until: EpochMs) { snoozedUntil[thread] = until }

    func addMessage(_ message: StoredMessage, member: Set<FolderID>? = nil) {
        messages[message.id] = message
        members[message.id] = member ?? [message.folderId]
        nextMessageID = max(nextMessageID, message.id + 1)
    }

    // MARK: AccountsRepository

    func accountHasMessages(_ id: AccountID) async throws -> Bool { messages.values.contains { $0.accountId == id } }
    func createAccount(_ input: NewAccount) async throws -> Account { mailUnused() }
    func account(id: AccountID) async throws -> Account? { accountsByID[id] }
    func account(email: String) async throws -> Account? { accountsByID.values.first { $0.email == email } }
    func listAccounts() async throws -> [Account] { Array(accountsByID.values) }
    func updateAccount(_ id: AccountID, _ patch: AccountPatch) async throws -> Account {
        guard var account = accountsByID[id] else { throw FlintError(.notFound, "No such account.") }
        if let server = patch.server { account.server = server }
        if let provider = patch.provider { account.provider = provider; providers[id] = provider }
        if let authKind = patch.authKind { account.authKind = authKind }
        accountsByID[id] = account
        return account
    }
    func deleteAccount(_ id: AccountID) async throws { mailUnused() }
    func ownAddresses() async throws -> Set<String> { ownAddresses }

    // MARK: FoldersRepository

    func upsertFolder(_ accountId: AccountID, _ input: FolderInput) async throws -> Folder {
        if let index = folders.firstIndex(where: { $0.accountId == accountId && $0.path == input.path }) {
            folders[index].role = input.role
            folders[index].name = input.name ?? folders[index].name
            return folders[index]
        }
        let folder = Folder(id: nextFolderID, accountId: accountId, path: input.path, name: input.name ?? input.path, role: input.role)
        nextFolderID += 1
        folders.append(folder)
        return folder
    }
    func folder(id: FolderID) async throws -> Folder? { folders.first { $0.id == id } }
    func folder(accountId: AccountID, path: String) async throws -> Folder? { folders.first { $0.accountId == accountId && $0.path == path } }
    func folder(accountId: AccountID, role: MailboxRole) async throws -> Folder? { folders.first { $0.accountId == accountId && $0.role == role } }
    func ensureFolder(accountId: AccountID, role: MailboxRole) async throws -> Folder {
        if let existing = folders.first(where: { $0.accountId == accountId && $0.role == role }) { return existing }
        let name = role.rawValue.prefix(1).uppercased() + role.rawValue.dropFirst()
        return try await upsertFolder(accountId, FolderInput(path: name, name: name, role: role))
    }
    func listFolders(accountId: AccountID) async throws -> [Folder] { folders.filter { $0.accountId == accountId } }
    func folderSyncState(_ folderId: FolderID) async throws -> FolderSyncState { syncStates[folderId] ?? FolderSyncState() }
    func setFolderSyncState(_ folderId: FolderID, _ patch: FolderSyncPatch) async throws {
        var state = syncStates[folderId] ?? FolderSyncState()
        if let value = patch.uidValidity { state.uidValidity = value }
        if let value = patch.uidNext { state.uidNext = value }
        if let value = patch.highestModseq { state.highestModseq = value }
        if let value = patch.syncedMinUid { state.syncedMinUid = value }
        if let value = patch.lastSyncAt { state.lastSyncAt = value }
        syncStates[folderId] = state
    }
    func resetFolder(_ folderId: FolderID) async throws -> [ThreadID] {
        resetFolders.append(folderId)
        let doomed = messages.values.filter { $0.folderId == folderId }
        for message in doomed { messages[message.id] = nil; members[message.id] = nil }
        syncStates[folderId] = FolderSyncState()
        return Array(Set(doomed.map(\.threadId))).sorted()
    }

    // MARK: IngestRepository

    func ingestMessages(_ accountId: AccountID, _ folderId: FolderID, _ items: [IngestMessage], context: IngestContext) async throws -> [IngestOutcome] {
        var outcomes: [IngestOutcome] = []
        let folderByPath = Dictionary(uniqueKeysWithValues: folders.filter { $0.accountId == accountId }.map { ($0.path, $0.id) })
        for item in items {
            if let existing = messages.values.first(where: { $0.folderId == folderId && $0.uid == item.uid }) {
                outcomes.append(IngestOutcome(uid: item.uid, messageRowId: existing.id, threadId: existing.threadId, isNew: false, category: .people))
                continue
            }
            let thread = threadFor(accountId: accountId, item: item)
            let row = nextMessageID
            nextMessageID += 1
            let from = item.from.first?.address.lowercased() ?? ""
            let fromMe = ownAddresses.contains(from)
            messages[row] = StoredMessage(
                id: row, accountId: accountId, threadId: thread, folderId: folderId, uid: item.uid, gmMsgid: item.gmMsgid, gmThrid: item.gmThrid,
                messageId: item.messageId, inReplyTo: item.inReplyTo, references: item.references, subject: item.subject, from: item.from, to: item.to,
                cc: item.cc, bcc: item.bcc, replyTo: item.replyTo, date: item.date, snippet: item.snippet ?? "", seen: item.flags.seen,
                flagged: item.flags.flagged, answered: item.flags.answered, draft: item.flags.draft, hasAttachments: item.hasAttachments, size: item.size,
                headers: item.headers, isFromMe: fromMe)
            var member: Set<FolderID> = [folderId]
            for path in item.gmLabels ?? [] { if let id = folderByPath[path] { member.insert(id) } }
            members[row] = member
            let blocked = blockedFrom.contains(from)
            let actions = item.messageId.flatMap { ruleActionsByMessageId[$0] } ?? []
            outcomes.append(IngestOutcome(
                uid: item.uid, messageRowId: row, threadId: thread, isNew: true, category: .people, fromMe: fromMe, blocked: blocked,
                ruleActions: context.evaluate ? actions : []))
        }
        return outcomes
    }

    private func threadFor(accountId: AccountID, item: IngestMessage) -> ThreadID {
        if let thrid = item.gmThrid, let hit = messages.values.first(where: { $0.accountId == accountId && $0.gmThrid == thrid }) { return hit.threadId }
        let related = Set(item.references + [item.inReplyTo].compactMap { $0 }.map(MailHeaders.unbracketed))
        if let hit = messages.values.first(where: { $0.accountId == accountId && ($0.messageId.map { related.contains(MailHeaders.unbracketed($0)) } ?? false) }) {
            return hit.threadId
        }
        defer { nextThreadID += 1 }
        return nextThreadID
    }

    func setBody(_ messageRowId: MessageRowID, _ body: MessageBody) async throws {
        bodiesSet[messageRowId] = body
        messages[messageRowId]?.bodyLoaded = true
        messages[messageRowId]?.text = body.text
        messages[messageRowId]?.rawHtml = body.html
    }

    func applyFlags(_ folderId: FolderID, _ updates: [FlagUpdate]) async throws -> [ThreadID] {
        var threads = Set<ThreadID>()
        for update in updates {
            guard let row = messages.values.first(where: { $0.folderId == folderId && $0.uid == update.uid }) else { continue }
            var changed = false
            if let seen = update.seen, seen != row.seen { messages[row.id]?.seen = seen; changed = true }
            if let flagged = update.flagged, flagged != row.flagged { messages[row.id]?.flagged = flagged; changed = true }
            if let answered = update.answered, answered != row.answered { messages[row.id]?.answered = answered; changed = true }
            if changed { threads.insert(row.threadId) }
        }
        return threads.sorted()
    }

    func applyGmailLabels(_ folderId: FolderID, _ updates: [(uid: Int, labels: [String])]) async throws -> [ThreadID] {
        var threads = Set<ThreadID>()
        for update in updates {
            guard let row = messages.values.first(where: { $0.folderId == folderId && $0.uid == update.uid }) else { continue }
            var member: Set<FolderID> = [folderId]
            for path in update.labels { if let id = folders.first(where: { $0.accountId == row.accountId && $0.path == path })?.id { member.insert(id) } }
            if member != members[row.id] { members[row.id] = member; threads.insert(row.threadId) }
        }
        return threads.sorted()
    }

    func removeUids(_ folderId: FolderID, _ uids: [Int]) async throws -> [ThreadID] {
        removedUids.append((folderId, uids))
        var threads = Set<ThreadID>()
        for row in messages.values where row.folderId == folderId && uids.contains(row.uid) {
            threads.insert(row.threadId)
            messages[row.id] = nil
            members[row.id] = nil
        }
        return threads.sorted()
    }

    func listLocalUids(_ folderId: FolderID, minUid: Int) async throws -> [Int] {
        listLocalUidsCalls += 1
        return messages.values.filter { $0.folderId == folderId && $0.uid >= minUid }.map(\.uid).sorted()
    }

    // MARK: SettingsRepository

    func settings() async throws -> Settings { settingsValue }
    func updateSettings(_ patch: JSONValue) async throws -> Settings { mailUnused() }

    // MARK: MessagesRepository

    func message(id: MessageRowID) async throws -> StoredMessage? { messages[id] }
    func messages(accountId: AccountID, messageId: String) async throws -> [StoredMessage] {
        messages.values.filter { $0.accountId == accountId && $0.messageId.map(MailHeaders.unbracketed) == MailHeaders.unbracketed(messageId) }
    }
    func message(folderId: FolderID, uid: Int) async throws -> StoredMessage? { messages.values.first { $0.folderId == folderId && $0.uid == uid } }
    func attachment(id: Int) async throws -> StoredAttachment? { attachmentsByID[id] }
    func setAttachmentCachedPath(_ id: Int, _ path: String?) async throws { attachmentsByID[id]?.cachedPath = path }
    var attachmentsByID: [Int: StoredAttachment] = [:]
    func addAttachment(_ id: Int, _ attachment: StoredAttachment) { attachmentsByID[id] = attachment }
    func messageLocations(_ ids: [MessageRowID]) async throws -> [MessageLocation] { ids.compactMap(location(of:)) }
    func threadLocations(_ threadIds: [ThreadID]) async throws -> [MessageLocation] {
        messages.values.filter { threadIds.contains($0.threadId) }.sorted { $0.id < $1.id }.compactMap { location(of: $0.id) }
    }
    func threadRows(_ threadId: ThreadID) async throws -> ThreadRows? {
        let rows = messages.values.filter { $0.threadId == threadId }.sorted { $0.id < $1.id }
        guard let first = rows.first else {
            return snoozedUntil[threadId] == nil ? nil : ThreadRows(id: threadId, accountId: "a1", subject: "snoozed", category: .people, snoozedUntil: snoozedUntil[threadId], messages: [])
        }
        return ThreadRows(id: threadId, accountId: first.accountId, subject: first.subject, category: .people, snoozedUntil: snoozedUntil[threadId], messages: rows)
    }

    func location(of row: MessageRowID) -> MessageLocation? {
        guard let message = messages[row], let folder = folders.first(where: { $0.id == message.folderId }) else { return nil }
        return MessageLocation(
            messageRowId: row, threadId: message.threadId, accountId: message.accountId, provider: providers[message.accountId] ?? .imap,
            folderId: folder.id, folderPath: folder.path, folderRole: folder.role, uid: message.uid, gmMsgid: message.gmMsgid, messageId: message.messageId,
            seen: message.seen, flagged: message.flagged, answered: message.answered, memberFolderIds: Array(members[row] ?? []).sorted())
    }

    // MARK: ThreadsRepository

    private func nextScripted() throws -> ActionResult {
        guard !scriptedResults.isEmpty else { return ActionResult(snapshot: ThreadSnapshot(threads: []), locations: []) }
        return scriptedResults.removeFirst()
    }

    func listThreads(_ query: ThreadQuery, now: EpochMs) async throws -> ThreadPage { mailUnused() }
    func threadItems(_ ids: [ThreadID]) async throws -> [ThreadListItem] {
        ids.map { id in
            let latest = messages.values.filter { $0.threadId == id }.max { $0.date < $1.date }
            return ThreadListItem(
                id: id, accountId: latest?.accountId ?? "a1", subject: latest?.subject ?? "", snippet: latest?.snippet ?? "", participants: latest?.from ?? [],
                lastDate: latest?.date ?? 0, messageCount: 1, unreadCount: 0, muted: threadMuted.contains(id), snoozedUntil: snoozedUntil[id])
        }
    }
    func sidebarData(now: EpochMs) async throws -> SidebarData { mailUnused() }
    func snapshotThreads(_ threadIds: [ThreadID]) async throws -> ThreadSnapshot { ThreadSnapshot(threads: []) }
    func restoreSnapshot(_ snapshot: ThreadSnapshot) async throws -> [ThreadID] {
        restoredSnapshots.append(snapshot)
        return snapshot.threads.map(\.id)
    }
    func markRead(_ threadIds: [ThreadID], read: Bool) async throws -> ActionResult {
        markedRead.append((threadIds, read))
        return try nextScripted()
    }
    func setPinned(_ threadIds: [ThreadID], pinned value: Bool) async throws -> ActionResult {
        pinned.append((threadIds, value))
        return try nextScripted()
    }
    func setMuted(_ threadIds: [ThreadID], muted: Bool) async throws -> ActionResult { mailUnused() }
    func snooze(_ threadIds: [ThreadID], until: EpochMs) async throws -> ActionResult {
        for id in threadIds { snoozedUntil[id] = until }
        return try nextScripted()
    }
    func unsnooze(_ threadIds: [ThreadID]) async throws -> ActionResult { mailUnused() }
    func listDueSnoozes(now: EpochMs) async throws -> [ThreadID] { snoozedUntil.filter { $0.value <= now }.map(\.key).sorted() }
    func wakeSnoozed(_ threadId: ThreadID, now: EpochMs) async throws -> ActionResult {
        snoozedUntil[threadId] = nil
        return try nextScripted()
    }
    func resurface(_ threadId: ThreadID, now: EpochMs) async throws { resurfaced.append(threadId) }
    func moveThreads(_ threadIds: [ThreadID], to target: MoveTarget) async throws -> ActionResult {
        movedTargets.append(target)
        return try nextScripted()
    }
    func relocateMessage(_ messageRowId: MessageRowID, folderId: FolderID, uid: Int) async throws {
        relocations.append((messageRowId, folderId, uid))
        messages[messageRowId]?.folderId = folderId
        messages[messageRowId]?.uid = uid
    }
    func pinCategory(_ threadIds: [ThreadID], _ category: MailCategory, source: CategorySource) async throws { mailUnused() }
    func recategorizeAll() async throws -> Int { mailUnused() }
    func headerRefreshTargets(accountId: AccountID, sinceMs: EpochMs) async throws -> [HeaderRefreshTarget] { mailUnused() }
    func mergeHeaders(_ folderId: FolderID, _ items: [(uid: Int, headers: [String: String])]) async throws -> Int {
        mergedHeaders.append((folderId, items.map(\.uid)))
        return items.count
    }
    var mergedHeaders: [(folder: FolderID, uids: [Int])] = []

    // MARK: PendingOpsRepository

    func addPendingOp(accountId: AccountID, _ op: PendingOpSpec, messageIds: [MessageRowID], now: EpochMs) async throws -> Int {
        let id = nextOpID
        nextOpID += 1
        pendingOps.append(PendingOp(id: id, accountId: accountId, spec: op, messageIds: messageIds, createdAt: now))
        return id
    }
    func removePendingOp(_ id: Int) async throws { pendingOps.removeAll { $0.id == id } }
    func bumpPendingOp(_ id: Int, error: String) async throws -> Int {
        guard let index = pendingOps.firstIndex(where: { $0.id == id }) else { return 0 }
        pendingOps[index].attempts += 1
        return pendingOps[index].attempts
    }
    func listPendingOps() async throws -> [PendingOp] { pendingOps }
}

// MARK: Drafts, scheduled sends, reminders, receipts

extension MailTestStore {
    func createDraft(_ input: NewDraft, now: EpochMs) async throws -> Draft {
        let id = nextDraftIDValue()
        let draft = Draft(
            id: id, accountId: input.accountId, from: input.from, mode: input.mode, sourceMessageId: input.sourceMessageId, threadId: input.threadId, to: input.to,
            cc: input.cc, bcc: input.bcc, subject: input.subject, html: input.html, quotedHtml: input.quotedHtml, attachments: input.attachments,
            signatureId: input.signatureId, track: input.track, remindAt: input.remindAt, createdBy: input.createdBy, updatedAt: now)
        setDraftValue(draft, meta: DraftMeta(inReplyTo: input.inReplyTo, references: input.references))
        return draft
    }
    func draft(id: Int) async throws -> Draft? { drafts[id] }
    func updateDraft(_ id: Int, _ patch: DraftPatch, now: EpochMs) async throws -> Draft {
        guard var d = drafts[id] else { throw FlintError(.notFound, "No such draft.") }
        if let v = patch.to { d.to = v }
        if let v = patch.cc { d.cc = v }
        if let v = patch.bcc { d.bcc = v }
        if let v = patch.subject { d.subject = v }
        if let v = patch.html { d.html = v }
        if let v = patch.track { d.track = v }
        if let v = patch.attachments { d.attachments = v }
        d.updatedAt = now
        drafts[id] = d
        return d
    }
    func deleteDraft(_ id: Int) async throws { drafts[id] = nil; draftMetas[id] = nil }
    func listDrafts() async throws -> [Draft] { drafts.values.sorted { $0.id < $1.id } }
    func findDraft(accountId: AccountID, serverMessageId: String?, folderId: FolderID, uid: Int) async throws -> Draft? { nil }
    func listDrafts(threadId: ThreadID) async throws -> [Draft] { drafts.values.filter { $0.threadId == threadId } }
    func draftMeta(_ id: Int) async throws -> DraftMeta { draftMetas[id] ?? DraftMeta() }
    func setDraftMeta(_ id: Int, _ meta: DraftMeta) async throws { draftMetas[id] = meta }

    func createScheduledSend(_ input: NewScheduledSend, now: EpochMs) async throws -> ScheduledSend {
        let draft = drafts[input.draftId]
        let row = ScheduledSend(
            id: nextScheduledIDValue(), draftId: input.draftId, subject: draft?.subject ?? "", to: draft?.to ?? [], sendAt: input.sendAt, status: input.status,
            requestedBy: input.requestedBy, createdAt: now)
        scheduled[row.id] = row
        return row
    }
    func scheduledSend(id: Int) async throws -> ScheduledSend? { scheduled[id] }
    func listDueScheduled(now: EpochMs) async throws -> [ScheduledSend] {
        scheduled.values.filter { $0.status == .pending && $0.sendAt <= now }.sorted { ($0.sendAt, $0.id) < ($1.sendAt, $1.id) }
    }
    func nextScheduledAt() async throws -> EpochMs? { scheduled.values.filter { $0.status == .pending }.map(\.sendAt).min() }
    func listScheduled() async throws -> [ScheduledSend] { scheduled.values.sorted { $0.id < $1.id } }
    func openScheduledSend(draftId: Int) async throws -> ScheduledSend? {
        scheduled.values.first { $0.draftId == draftId && [.pending, .awaitingApproval, .sending].contains($0.status) }
    }
    func updateScheduled(_ id: Int, _ patch: ScheduledSendPatch) async throws -> ScheduledSend {
        guard var row = scheduled[id] else { throw FlintError(.notFound, "No such send.") }
        if let v = patch.status { row.status = v }
        if let v = patch.error { row.error = v }
        if let v = patch.attempts { row.attempts = v }
        if let v = patch.messageId { row.messageId = v }
        if let v = patch.sendAt { row.sendAt = v }
        scheduled[id] = row
        return row
    }

    func createReminder(accountId: AccountID, threadId: ThreadID?, messageId: String, remindAt: EpochMs) async throws -> Reminder {
        let reminder = Reminder(id: nextReminderIDValue(), accountId: accountId, threadId: threadId, messageId: messageId, remindAt: remindAt)
        reminders[reminder.id] = reminder
        return reminder
    }
    func reminder(id: Int) async throws -> Reminder? { reminders[id] }
    func listDueReminders(now: EpochMs) async throws -> [Reminder] { reminders.values.filter { $0.status == .pending && $0.remindAt <= now }.sorted { $0.id < $1.id } }
    func nextReminderAt() async throws -> EpochMs? { reminders.values.filter { $0.status == .pending }.map(\.remindAt).min() }
    func listPendingReminders(limit: Int) async throws -> [Reminder] { Array(reminders.values.filter { $0.status == .pending }.sorted { $0.id < $1.id }.prefix(limit)) }
    func setReminderStatus(_ id: Int, _ status: ReminderStatus) async throws { reminders[id]?.status = status }
    func cancelReminders(accountId: AccountID, messageId: String) async throws {
        for (id, r) in reminders where r.accountId == accountId && r.messageId == messageId { reminders[id]?.status = .cancelled }
    }
    func threadHasReply(_ threadId: ThreadID, since: EpochMs) async throws -> Bool { repliedThreads.contains(threadId) }

    func createTracked(_ input: NewTracked) async throws -> Int { mailUnused() }
    func linkSentMessage(accountId: AccountID, ref: String?, messageId: String, threadId: ThreadID) async throws { linkedSent.append((ref, messageId, threadId)) }
    func setTrackedState(_ trackedId: Int, _ state: NewTracked.State) async throws { trackedStates[trackedId] = state }
    func findTracked(ref: String) async throws -> Int? { trackedRefs[ref] }
    func findTracked(accountId: AccountID, messageId: String) async throws -> Int? { nil }
    func listPollable(sinceMs: EpochMs) async throws -> [PollableTracked] { mailUnused() }
    func tracked(id: Int) async throws -> TrackedMessage? { mailUnused() }
    func listTracked(limit: Int?, unopenedOnly: Bool?) async throws -> [TrackedMessage] { mailUnused() }
    func receiptDetail(trackedId: Int) async throws -> ReceiptDetail { mailUnused() }
    func receiptDetail(accountId: AccountID, messageId: String) async throws -> ReceiptDetail? { mailUnused() }
    func ingestReceiptEvents(_ events: [ReceiptEventInput], now: EpochMs) async throws -> [ReceiptChange] { mailUnused() }
    func recomputeReceipts(threadId: ThreadID, now: EpochMs) async throws -> [ReceiptChange] { mailUnused() }
}

// MARK: - Builders

let mailTestServer = ServerConfig(imapHost: "127.0.0.1", imapPort: 3143, imapSecure: false, smtpHost: "127.0.0.1", smtpPort: 3025, smtpSecure: false, username: "me@test.local")
let mailTestConfig = MailTransportConfiguration(server: mailTestServer, credential: .password(user: "me@test.local", password: "pw"))

func mailTestAccount(provider: MailProvider = .imap, id: AccountID = "a1") -> Account {
    Account(id: id, email: "me@test.local", name: "Me", provider: provider, authKind: .password, server: mailTestServer)
}

func mailTestEnvelope(
    _ subject: String, from: String = "ann@example.com", flags: Set<String> = [], messageId: String? = nil, ageDays: Double = 0,
    now: Date = Date(timeIntervalSince1970: 1_800_000_000), structure: BodyPart? = nil, headers: [String: String] = [:], gmail: GmailAttributes? = nil
) -> RemoteEnvelope {
    let date = now.addingTimeInterval(-ageDays * 86_400)
    return RemoteEnvelope(
        uid: 0, flags: flags, internalDate: date, size: 100, messageId: messageId ?? "<\(UUID().uuidString)@example.com>", subject: subject, date: date,
        from: [Address(name: "Ann", address: from)], to: [Address(address: "me@test.local")], headers: headers,
        bodyStructure: structure ?? BodyPart(number: "1", type: "text", subtype: "plain", parameters: ["charset": "utf-8"], encoding: "7bit", size: 5), gmail: gmail)
}

let mailTestNow: EpochMs = 1_800_000_000_000

/// A settable clock for tests.
final class MailTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: EpochMs
    init(_ start: EpochMs = mailTestNow) { value = start }
    var now: EpochMs { lock.lock(); defer { lock.unlock() }; return value }
    func advance(_ ms: Int) { lock.lock(); value += ms; lock.unlock() }
}

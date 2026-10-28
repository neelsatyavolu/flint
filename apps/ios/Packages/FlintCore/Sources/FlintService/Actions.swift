// Thread actions the UI calls. Each runs optimistically (local change, "mail changed", server operation) and returns an undo
// token. Port of packages/core/src/service/actions.ts, categories.ts and blocked.ts.

import FlintClassify
import FlintMail
import FlintModel
import FlintStore
import Foundation

extension ServiceCore {
    static let maxCategorySenders = 25
    static let senderThreadLimit = 200
    static let blockedRestoreWindowMs = 30 * 24 * 60 * 60 * 1000

    // MARK: Local-only actions (snooze, mute)

    func snooze(_ ids: [ThreadID], until: EpochMs) async throws -> String {
        let t = try checked(ids)
        guard until > 0 else { throw FlintError(.invalid, "Choose a time to come back.") }
        let store = self.store
        let token = try await optimistic.run(OptimisticSpec(label: "snooze", local: { try await store.snooze(t, until: until) }))
        pump.poke()
        return token
    }

    func unsnooze(_ ids: [ThreadID]) async throws -> String {
        let t = try checked(ids)
        let store = self.store
        let token = try await optimistic.run(OptimisticSpec(label: "unsnooze", local: { try await store.unsnooze(t) }))
        pump.poke()
        return token
    }

    func setMuted(_ ids: [ThreadID], muted: Bool) async throws -> String {
        let t = try checked(ids)
        let store = self.store
        return try await optimistic.run(OptimisticSpec(label: muted ? "mute" : "unmute", local: { try await store.setMuted(t, muted: muted) }))
    }

    func checked(_ ids: [ThreadID]) throws -> [ThreadID] {
        guard ids.count <= ThreadActions.maxThreads, ids.allSatisfy({ $0 > 0 }) else { throw FlintError(.invalid, "That selection isn't valid.") }
        return ids
    }

    // MARK: Undo

    func undo(_ token: String) async throws {
        do {
            try await threadActions.undo(token)
        } catch {
            await categoryUndo.forget(token)
            throw error
        }
        await categoryUndo.run(token)
        pump.poke()
    }

    // MARK: Categories

    /// Files these threads under a category. The choice is the user's, so automatic categorizing never overrides it. With
    /// `sender`, the senders are remembered (a rule) so their future mail lands there too, and their mail in the inbox moves.
    func setCategory(_ ids: [ThreadID], _ category: MailCategory, sender: Bool) async throws -> String {
        let requested = try checked(ids)
        guard !requested.isEmpty else { throw FlintError(.invalid, "That selection isn't valid.") }
        let senders = sender ? Array(await sendersOf(requested).prefix(Self.maxCategorySenders)) : []
        var all = requested
        for id in await threadsFrom(senders) where !all.contains(id) { all.append(id) }
        let store = self.store
        let targets = all
        let token = try await optimistic.run(OptimisticSpec(label: "change the category", local: {
            let snapshot = try await store.snapshotThreads(targets)
            try await store.pinCategory(targets, category, source: .manual)
            return ActionResult(snapshot: snapshot, locations: [])
        }))
        if !senders.isEmpty {
            let restore = await rememberSenders(senders, category: category)
            await categoryUndo.register(token: token, restore: restore)
        }
        return token
    }

    /// The sender of the first received message in each thread, lower-cased and unique.
    private func sendersOf(_ ids: [ThreadID]) async -> [String] {
        var out: [String] = []
        for id in ids {
            guard let rows = try? await store.threadRows(id),
                  let first = rows.messages.first(where: { !$0.isFromMe && !$0.draft && !$0.from.isEmpty }),
                  let address = first.from.first?.address.lowercased(), !out.contains(address) else { continue }
            out.append(address)
        }
        return out
    }

    /// Inbox threads that also involve these senders, so "always" moves what is already there too.
    private func threadsFrom(_ senders: [String]) async -> [ThreadID] {
        var out: [ThreadID] = []
        for address in senders {
            let query = ThreadQuery(view: .search, search: "in:inbox from:\(address)", limit: Self.senderThreadLimit)
            guard let page = try? await store.listThreads(query, now: now()) else { continue }
            for item in page.items where item.participants.contains(where: { $0.address.lowercased() == address }) && !out.contains(item.id) {
                out.append(item.id)
            }
        }
        return out
    }

    private func isSenderRule(_ rule: Rule, _ address: String) -> Bool {
        guard rule.accountId == nil, rule.conditions.count == 1, rule.actions.count == 1, case .category = rule.actions[0] else { return false }
        let c = rule.conditions[0]
        return c.field == .from && c.op == .equals && c.value.lowercased() == address
    }

    /// Creates or updates the rule for each sender. Returns the work that puts the rules back as they were.
    private func rememberSenders(_ senders: [String], category: MailCategory) async -> @Sendable () async -> Void {
        let store = self.store
        var undo: [@Sendable () async -> Void] = []
        let rules = (try? await store.listRules()) ?? []
        var sortOrder = rules.map(\.sortOrder).max() ?? 0
        for address in senders {
            if let existing = rules.first(where: { isSenderRule($0, address) }) {
                var changed = existing
                changed.enabled = true
                changed.actions = [.category(category)]
                if (try? await store.saveRule(changed)) != nil { undo.append { _ = try? await store.saveRule(existing) } }
            } else {
                sortOrder += 1
                let fresh = Rule(
                    id: 0, name: "Mail from \(address)", enabled: true, accountId: nil, match: .all,
                    conditions: [RuleCondition(field: .from, op: .equals, value: address)], actions: [.category(category)], sortOrder: sortOrder)
                if let saved = try? await store.saveRule(fresh) { undo.append { try? await store.deleteRule(saved.id) } }
            }
        }
        let steps = undo
        return { for step in steps.reversed() { await step() } }
    }

    // MARK: Blocked senders

    func blockSender(_ input: String) async throws {
        let pattern = try await store.blockSender(input)
        await trashExisting(pattern)
        await announceAllAccounts()
    }

    func unblockSender(_ input: String) async throws {
        guard let pattern = RuleMatcher.normalizeBlockPattern(input) else { throw FlintError(.invalid, "Enter an email address or a domain.") }
        let restore = await recentlyBlocked(pattern)
        _ = try await store.unblockSender(pattern)
        if !restore.isEmpty {
            _ = try? await threadActions.moveToInbox(restore)
        }
        await announceAllAccounts()
    }

    /// Existing inbox mail from a newly blocked sender goes to Trash, where the Blocked view lists it.
    private func trashExisting(_ pattern: String) async {
        let query = ThreadQuery(view: .search, search: "in:inbox from:\(pattern)", limit: 200)
        guard let ids = try? await store.listThreads(query, now: now()).items.map(\.id), !ids.isEmpty else { return }
        _ = try? await threadActions.trash(ids)
    }

    /// Trashed threads from this sender in the last 30 days, newest first.
    private func recentlyBlocked(_ pattern: String) async -> [ThreadID] {
        let only: Set<String> = [pattern]
        let cutoff = now() - Self.blockedRestoreWindowMs
        var ids: [ThreadID] = []
        var cursor: String?
        for _ in 0..<10 {
            let query = ThreadQuery(view: .blocked, cursor: cursor, limit: 200)
            guard let page = try? await store.listThreads(query, now: now()) else { break }
            let fresh = page.items.filter { $0.lastDate >= cutoff }
            ids += fresh.filter { $0.participants.contains { RuleMatcher.senderMatchesBlocked($0.address, patterns: only) } }.map(\.id)
            guard let next = page.nextCursor, fresh.count == page.items.count else { break }
            cursor = next
        }
        return ids
    }

    func announceAllAccounts() async {
        for account in (try? await store.listAccounts()) ?? [] { emit(.mailChanged(accountId: account.id, threadIds: [])) }
    }
}

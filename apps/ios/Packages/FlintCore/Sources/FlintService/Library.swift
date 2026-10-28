// Signatures, templates and rules (what the Settings screens edit), and "apply rules to existing mail".
// Port of packages/core/src/service/compose-library.ts.
//
// Id convention (HANDOFF 2A): a value with `id <= 0` is new and is created; any other id replaces that row.

import FlintClassify
import FlintHTML
import FlintMail
import FlintModel
import FlintStore
import Foundation

extension ServiceCore {
    static let applyRulesPage = 200

    func saveSignature(_ signature: Signature) async throws -> Signature {
        for id in signature.accountIds {
            guard try await store.account(id: id) != nil else { throw FlintError(.invalid, "One of the accounts for that signature doesn't exist.") }
        }
        guard signature.html.count <= 200_000 else { throw FlintError(.invalid, "That signature is too long.") }
        return try await store.saveSignature(signature, now: now())
    }

    func saveTemplate(_ template: Template) async throws -> Template {
        guard template.html.count <= 1_000_000 else { throw FlintError(.invalid, "That template is too long.") }
        return try await store.saveTemplate(template, now: now())
    }

    func saveRule(_ rule: Rule) async throws -> Rule {
        for condition in rule.conditions where condition.op == .matches {
            guard (try? NSRegularExpression(pattern: condition.value, options: .caseInsensitive)) != nil else {
                throw FlintError(.invalid, "\"\(condition.value)\" is not a valid pattern.")
            }
        }
        if let accountId = rule.accountId, try await store.account(id: accountId) == nil {
            throw FlintError(.notFound, "That account no longer exists.")
        }
        return try await store.saveRule(rule)
    }

    // MARK: Apply rules to existing mail

    /// Runs enabled rules over the inbox; returns how many threads changed.
    func applyRules(ruleId: Int?) async throws -> Int {
        let picked: [Rule]
        if let ruleId {
            guard let rule = try await store.rule(id: ruleId) else { throw FlintError(.notFound, "That rule no longer exists.") }
            picked = [rule]
        } else {
            picked = try await store.listRules().filter(\.enabled)
        }
        let rules = picked.map { rule -> Rule in var copy = rule; copy.enabled = true; return copy }
        guard !rules.isEmpty else { return 0 }

        var threadIds: [ThreadID] = []
        var cursor: String?
        repeat {
            let page = try await store.listThreads(ThreadQuery(view: .inbox, cursor: cursor, limit: Self.applyRulesPage), now: now())
            threadIds += page.items.map(\.id)
            cursor = page.nextCursor
        } while cursor != nil

        let plan = try await planActions(rules, threadIds)
        var byAction: [RuleAction: [ThreadID]] = [:]
        var order: [RuleAction] = []
        for (threadId, actions) in plan.sorted(by: { $0.key < $1.key }) {
            for action in actions {
                if byAction[action] == nil { order.append(action) }
                byAction[action, default: []].append(threadId)
            }
        }
        for action in order { try await perform(action, byAction[action] ?? []) }
        return plan.values.filter { $0.contains { if case .notify = $0 { return false } else { return true } } }.count
    }

    /// Every received message of the inbox threads, evaluated against the rules. Actions are listed per thread.
    private func planActions(_ rules: [Rule], _ threadIds: [ThreadID]) async throws -> [ThreadID: [RuleAction]] {
        if rules.contains(where: { $0.conditions.contains { $0.field == .body } }) {
            var rowsToFetch: [StoredMessage] = []
            for id in threadIds { rowsToFetch += (try? await store.threadRows(id))?.messages ?? [] }
            await ensureBodies(rowsToFetch, wait: nil)
        }
        var plan: [ThreadID: [RuleAction]] = [:]
        for threadId in threadIds {
            guard let rows = try await store.threadRows(threadId) else { continue }
            var actions: [RuleAction] = []
            for m in rows.messages where !m.isFromMe && !m.draft {
                let message = RuleMessage(
                    accountId: m.accountId, from: m.from, to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject,
                    body: m.text ?? m.rawHtml.map { HTMLTextBridge.plain($0) } ?? "", headers: m.headers, hasAttachments: m.hasAttachments)
                let applicable = rules.filter { $0.accountId == nil || $0.accountId == m.accountId }
                for action in RuleMatcher.evaluateRules(applicable, message) where !actions.contains(action) { actions.append(action) }
            }
            if !actions.isEmpty { plan[threadId] = actions }
        }
        return plan
    }

    /// Runs one action for several threads through the optimistic pipeline, so it reaches the server and fails like any other.
    private func perform(_ action: RuleAction, _ ids: [ThreadID]) async throws {
        guard !ids.isEmpty else { return }
        let store = self.store
        switch action {
        case .archive: _ = try await threadActions.archive(ids)
        case .trash: _ = try await threadActions.trash(ids)
        case .markRead: _ = try await threadActions.markRead(ids, read: true)
        case .pin: _ = try await threadActions.setPinned(ids, pinned: true)
        case .mute: _ = try await optimistic.run(OptimisticSpec(label: "mute", local: { try await store.setMuted(ids, muted: true) }))
        case .category(let category):
            _ = try await optimistic.run(OptimisticSpec(label: "change the category", local: {
                let snapshot = try await store.snapshotThreads(ids)
                try await store.pinCategory(ids, category, source: .rule)
                return ActionResult(snapshot: snapshot, locations: [])
            }))
        case .move(let folderPath):
            for entry in await optimistic.accountsOf(ids) {
                guard let folder = try await store.folder(accountId: entry.accountId, path: folderPath) else { continue }
                _ = try await threadActions.moveToFolder(entry.threadIds, folderId: folder.id)
            }
        case .notify: break
        }
    }
}

enum HTMLTextBridge {
    static func plain(_ html: String) -> String { HTMLText.htmlToText(html) }
}

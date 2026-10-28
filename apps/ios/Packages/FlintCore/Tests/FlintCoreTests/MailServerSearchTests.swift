import FlintModel
import Foundation
import Testing
@testable import FlintMail

/// Cases of a shared fixture file (packages/core/fixtures, copied by scripts/sync-fixtures.sh).
struct MailFixtureCase: Decodable, Sendable, CustomTestStringConvertible {
    var name: String
    var input: [String: JSONValue]
    var expect: JSONValue
    var testDescription: String { name }
}

enum MailFixtures {
    private struct File: Decodable { var cases: [MailFixtureCase] }

    static func cases(_ file: String, fn: String) -> [MailFixtureCase] {
        guard let url = Bundle.module.url(forResource: file, withExtension: "json", subdirectory: "Fixtures"),
              let data = try? Data(contentsOf: url), let parsed = try? JSONDecoder().decode(File.self, from: data) else { return [] }
        return parsed.cases.filter { $0.input["fn"] == .string(fn) }
    }

    /// The fixture's day strings are local calendar days; the generating machine was in Los Angeles.
    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return c
    }()

    static func date(_ day: String) -> Date? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func day(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

private func string(_ value: JSONValue?) -> String? { if case .string(let s)? = value { return s } else { return nil } }
private func bool(_ value: JSONValue?) -> Bool? { if case .bool(let b)? = value { return b } else { return nil } }
private func strings(_ value: JSONValue?) -> [String] {
    guard case .array(let list)? = value else { return [] }
    return list.compactMap { string($0) }
}

@Suite("Server search")
struct MailServerSearchTests {
    @Test func theFixtureFileIsFound() {
        // A parameterized test over an empty list passes silently, so prove the cases were loaded.
        #expect(MailFixtures.cases("search", fn: "buildImapCriteria").count == 6)
        #expect(MailFixtures.cases("search", fn: "inTargets").count == 3)
    }

    @Test(arguments: MailFixtures.cases("search", fn: "buildImapCriteria"))
    func imapCriteriaFromTheFixture(_ c: MailFixtureCase) throws {
        guard case .object(let expected) = c.expect else {
            #expect(ServerSearchQuery().criteria() == nil) // null: nothing to ask the server
            return
        }
        let query = ServerSearchQuery(
            from: string(expected["from"]), to: string(expected["to"]), cc: string(expected["cc"]), subject: string(expected["subject"]), text: string(expected["text"]),
            seen: bool(expected["seen"]), flagged: bool(expected["flagged"]), since: string(expected["since"]).flatMap(MailFixtures.date),
            before: string(expected["before"]).flatMap(MailFixtures.date))
        let criteria = try #require(query.criteria())
        var parts: [SearchCriteria]
        if case .and(let list) = criteria { parts = list } else { parts = [criteria] }

        func take(_ match: (SearchCriteria) -> Bool) -> Bool {
            guard let index = parts.firstIndex(where: match) else { return false }
            parts.remove(at: index)
            return true
        }
        for name in ["from", "to", "cc", "subject"] {
            if let value = string(expected[name]) { #expect(take { $0 == .header(name: name, value: value) }, "missing \(name)") }
        }
        if let text = string(expected["text"]) { #expect(take { $0 == .text(text) }) }
        if let seen = bool(expected["seen"]) { #expect(take { $0 == (seen ? .seen : .unseen) }) }
        if bool(expected["flagged"]) == true { #expect(take { $0 == .flagged }) }
        if let day = string(expected["since"]) { #expect(take { if case .since(let d) = $0 { return MailFixtures.day(d) == day } else { return false } }) }
        if let day = string(expected["before"]) { #expect(take { if case .before(let d) = $0 { return MailFixtures.day(d) == day } else { return false } }) }
        #expect(parts.isEmpty, "unexpected extra criteria \(parts)")
    }

    private static let folders: [Folder] = [
        Folder(id: 1, accountId: "a1", path: "INBOX", name: "INBOX", role: .inbox), Folder(id: 2, accountId: "a1", path: "Sent", name: "Sent", role: .sent),
        Folder(id: 3, accountId: "a1", path: "Drafts", name: "Drafts", role: .drafts), Folder(id: 4, accountId: "a1", path: "Trash", name: "Trash", role: .trash),
        Folder(id: 5, accountId: "a1", path: "Junk", name: "Junk", role: .spam), Folder(id: 6, accountId: "a1", path: "Archive", name: "Archive", role: .archive),
        Folder(id: 7, accountId: "a1", path: "Projects", name: "Projects"), Folder(id: 8, accountId: "a1", path: "Receipts", name: "Receipts"),
    ]
    private static let allSynced = Set(folders.map(\.id))
    private let query = ServerSearchQuery(text: "invoice")

    @Test(arguments: MailFixtures.cases("search", fn: "inTargets"))
    func foldersFromTheInOperatorsOfTheFixture(_ c: MailFixtureCase) throws {
        guard case .object(let expected) = c.expect else { return }
        let roles = strings(expected["roles"]), names = strings(expected["names"])
        let plan = ServerSearchPlanner.plan(query, roles: roles, names: names, folders: Self.folders, synced: Self.allSynced, gmail: false)
        let picked = Set(plan.map(\.folderId))
        let wanted = Set(Self.folders.filter { folder in
            (folder.role.map { roles.contains($0.rawValue) } ?? false) || names.contains(folder.name.lowercased())
        }.map(\.id))
        #expect(picked == wanted && !picked.isEmpty)
        #expect(plan.allSatisfy { $0.criteria == .text("invoice") })
    }

    @Test func withoutInOperatorsItSearchesInboxSentArchiveAndPlainFolders() {
        let plan = ServerSearchPlanner.plan(query, folders: Self.folders, synced: Self.allSynced, gmail: false)
        #expect(Set(plan.map(\.folderId)) == [1, 2, 6, 7, 8])
    }

    @Test func foldersNeverSyncedAreSkipped() {
        let plan = ServerSearchPlanner.plan(query, folders: Self.folders, synced: [1, 7], gmail: false)
        #expect(Set(plan.map(\.folderId)) == [1, 7])
    }

    @Test func gmailSearchesAllMailUnlessTheQueryNamesTrashOrSpam() {
        var folders = Self.folders
        folders.append(Folder(id: 9, accountId: "a1", path: "[Gmail]/All Mail", name: "All Mail", role: .all))
        #expect(ServerSearchPlanner.plan(query, folders: folders, synced: Self.allSynced, gmail: true).map(\.folderId) == [9])
        #expect(ServerSearchPlanner.plan(query, roles: ["trash"], folders: folders, synced: Self.allSynced, gmail: true).map(\.folderId) == [4])
        #expect(ServerSearchPlanner.plan(query, roles: ["spam", "sent"], folders: folders, synced: Self.allSynced, gmail: true).map(\.folderId) == [5])
    }

    @Test func anEmptyQueryAsksNothing() {
        #expect(ServerSearchPlanner.plan(ServerSearchQuery(), folders: Self.folders, synced: Self.allSynced, gmail: false).isEmpty)
    }

    @Test func aSessionPlansAndRunsTheSearchForAQuery() async throws {
        let r = await MailSessionRig.make()
        for i in 0..<3 { await r.fake.deliver(mailTestEnvelope("old\(i)", ageDays: 400), to: "INBOX") }
        await r.fake.deliver(mailTestEnvelope("recent", ageDays: 1), to: "INBOX")
        try await r.session.syncNow()
        let found = try await r.session.searchServer(ServerSearchQuery(text: "old"), roles: ["inbox"])
        #expect(found.found == 3 && found.added == 3)
        #expect(await r.rows("INBOX").count == 4)
        #expect(try await r.session.searchServer(ServerSearchQuery()).found == 0)
    }
}

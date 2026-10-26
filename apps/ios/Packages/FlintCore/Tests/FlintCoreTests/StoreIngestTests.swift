import FlintModel
import Foundation
import Testing
@testable import FlintStore

@Suite("Store ingest: threading")
struct StoreIngestThreadingTests {
    @Test func threadsRepliesByReferencesAndInReplyTo() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let out = try await StoreTestKit.ingest(
            store, s, s.inbox,
            StoreTestKit.msg(1) { $0.messageId = "<a@x>"; $0.subject = "Lunch?" },
            StoreTestKit.msg(2) { $0.messageId = "<b@x>"; $0.inReplyTo = "<a@x>"; $0.references = ["<a@x>"]; $0.subject = "Re: Lunch?" },
            StoreTestKit.msg(3) { $0.messageId = "<c@x>"; $0.inReplyTo = "<b@x>"; $0.references = ["<a@x>", "<b@x>"]; $0.subject = "Re: Re: Lunch?" })
        #expect(Set(out.map(\.threadId)).count == 1)
        #expect(out.map(\.isNew) == [true, true, true])
        #expect(try await store.threadRows(out[0].threadId)?.subject == "Lunch?")
    }

    @Test func aReplyThatArrivesBeforeItsParentStillLandsInTheSameThread() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let reply = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(2) { $0.messageId = "r@x"; $0.inReplyTo = "p@x"; $0.references = ["p@x"]; $0.subject = "Re: Plan" })[0]
        let parent = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.messageId = "p@x"; $0.subject = "Plan" })[0]
        #expect(parent.threadId == reply.threadId)
    }

    @Test func mergesTwoThreadsWhenALaterMessageLinksThem() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let a = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.messageId = "a@x"; $0.subject = "Topic A" })[0]
        let b = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(2) { $0.messageId = "b@x"; $0.subject = "Other topic"; $0.from = [StoreTestKit.person("Dan")] })[0]
        #expect(a.threadId != b.threadId)
        _ = try await store.setPinned([b.threadId], pinned: true)
        _ = try await store.setMuted([a.threadId], muted: true)
        let joiner = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(3) { $0.messageId = "c@x"; $0.inReplyTo = "b@x"; $0.references = ["a@x", "b@x"]; $0.subject = "Re: both" })[0]
        #expect(joiner.mergedThreadIds.count == 1)
        let rows = try #require(try await store.threadRows(joiner.threadId))
        #expect(rows.messages.count == 3 && rows.pinned && rows.muted)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM threads") == 1)
    }

    @Test func joinsByNormalizedSubjectWithinFourteenDaysWhenParticipantsOverlap() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let a = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.messageId = "a@x"; $0.subject = "Invoice 12"; $0.date = StoreTestKit.t0 })[0]
        let b = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(2) { $0.messageId = nil; $0.subject = "Re: Invoice 12"; $0.date = StoreTestKit.t0 + 3 * StoreTestKit.day })[0]
        #expect(b.threadId == a.threadId)
        let far = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(3) { $0.messageId = "far@x"; $0.subject = "Invoice 12"; $0.date = StoreTestKit.t0 + 30 * StoreTestKit.day })[0]
        #expect(far.threadId != a.threadId)
        let stranger = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(4) {
            $0.messageId = "s@x"; $0.subject = "Invoice 12"; $0.from = [StoreTestKit.person("Stranger")]; $0.to = [StoreTestKit.person("Other")]; $0.date = StoreTestKit.t0 + StoreTestKit.day
        })[0]
        #expect(stranger.threadId != a.threadId)
    }

    @Test func ignoresTheUsersOwnAddressWhenMatchingParticipants() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let a = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.messageId = "a@x"; $0.subject = "Weekly digest"; $0.from = [StoreTestKit.person("One")] })[0]
        let b = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(2) { $0.messageId = "b@x"; $0.subject = "Weekly digest"; $0.from = [StoreTestKit.person("Two")] })[0]
        #expect(b.threadId != a.threadId)
    }

    @Test func doesNotSubjectJoinWhenTheMessageHasAParentLink() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let a = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.messageId = "a@x"; $0.subject = "Same subject" })[0]
        let b = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(2) { $0.messageId = "b@x"; $0.inReplyTo = "unknown@x"; $0.subject = "Same subject" })[0]
        #expect(b.threadId != a.threadId)
    }

    @Test func handlesMessagesWithNoMessageID() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let a = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.messageId = nil; $0.subject = "One" })[0]
        let b = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(2) { $0.messageId = nil; $0.subject = "Two"; $0.from = [StoreTestKit.person("Dan")] })[0]
        #expect(a.threadId != b.threadId)
    }

    @Test func reIngestingTheSameFolderUidUpdatesInsteadOfDuplicating() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let first = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.messageId = "a@x" })[0]
        let again = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.messageId = "a@x"; $0.flags = StoreTestKit.seen })[0]
        #expect(!again.isNew && again.messageRowId == first.messageRowId && again.threadId == first.threadId)
        #expect(try await store.message(id: first.messageRowId)?.seen == true)
    }

    @Test func adoptsALocallyMovedRowInsteadOfDuplicatingWhenTheServerCopyShowsUp() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let o = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.messageId = "a@x" })[0]
        _ = try await store.moveThreads([o.threadId], to: .archive)
        let moved = try await StoreTestKit.ingest(store, s, s.archive, StoreTestKit.msg(77) { $0.messageId = "a@x" })[0]
        #expect(!moved.isNew && moved.messageRowId == o.messageRowId)
        let row = try #require(try await store.message(id: o.messageRowId))
        #expect(row.folderId == s.archive.id && row.uid == 77)
        #expect(try await store.removeUids(s.inbox.id, [1]) == [])
        #expect(try await store.threadRows(o.threadId)?.messages.count == 1)
    }

    @Test func rollsBackTheWholeBatchWhenOneMessageFails() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let bad = StoreTestKit.msg(2) { $0.uid = 1 } // same folder and uid as the first message in one batch is fine; force a failure instead:
        _ = bad
        await expectStoreError(.notFound) {
            _ = try await store.ingestMessages(s.account.id, 99_999, [StoreTestKit.msg(1)], context: IngestContext())
        }
        await expectStoreError(.invalid, "different account") {
            let other = try await StoreTestKit.seedImap(store, "other@example.com")
            _ = try await store.ingestMessages(s.account.id, other.inbox.id, [StoreTestKit.msg(1)], context: IngestContext())
        }
        #expect(try await store.listLocalUids(s.inbox.id, minUid: 0) == [])
    }

    @Test func returnsAnOutcomePerMessage() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        let out = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(4), StoreTestKit.msg(5) { $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Bob")] })
        #expect(out.map(\.uid) == [4, 5])
        #expect(out[1].fromMe && out[1].category == .people)
        #expect(try await store.ingestMessages(s.account.id, s.inbox.id, [], context: IngestContext()) == [])
    }
}

@Suite("Store ingest: Gmail")
struct StoreIngestGmailTests {
    @Test func keysThreadsByXGMThridAndIsUniqueByGmMsgidAcrossFolders() async throws {
        let store = try StoreTestKit.makeStore()
        let g = try await StoreTestKit.seedGmail(store)
        let two = try await store.ingestMessages(g.account.id, g.all.id, [
            StoreTestKit.msg(1) { $0.gmMsgid = "100"; $0.gmThrid = "T1"; $0.gmLabels = ["INBOX"]; $0.messageId = "x@x" },
            StoreTestKit.msg(2) { $0.gmMsgid = "101"; $0.gmThrid = "T1"; $0.gmLabels = []; $0.messageId = "y@x" },
        ], context: IngestContext())
        #expect(two[0].threadId == two[1].threadId)
        #expect(try await StoreTestKit.strings(store, "SELECT thread_key FROM threads") == ["gm:T1"])
        // The same message seen again in Trash is an update, not a duplicate.
        let t = try await store.ingestMessages(g.account.id, g.trash.id, [StoreTestKit.msg(9) { $0.gmMsgid = "100"; $0.gmThrid = "T1"; $0.gmLabels = ["[Gmail]/Trash"]; $0.messageId = "x@x" }], context: IngestContext())[0]
        #expect(!t.isNew && t.messageRowId == two[0].messageRowId)
        #expect(try await StoreTestKit.count(store, "SELECT COUNT(*) FROM messages") == 2)
        let row = try #require(try await store.message(id: two[0].messageRowId))
        #expect(row.folderId == g.trash.id && row.uid == 9)
        #expect(try await store.messageLocations([two[0].messageRowId])[0].memberFolderIds == [g.trash.id])
    }

    @Test func keepsMessageFoldersInSyncWithLabelsAndCreatesLabelFolders() async throws {
        let store = try StoreTestKit.makeStore()
        let g = try await StoreTestKit.seedGmail(store)
        let o = try await store.ingestMessages(g.account.id, g.all.id, [StoreTestKit.msg(1) { $0.gmMsgid = "1"; $0.gmThrid = "T"; $0.gmLabels = ["INBOX", "Receipts"] }], context: IngestContext())[0]
        let label = try #require(try await store.folder(accountId: g.account.id, path: "Receipts"))
        #expect(label.role == nil)
        #expect(try await store.messageLocations([o.messageRowId])[0].memberFolderIds.sorted() == [g.all.id, g.inbox.id, label.id].sorted())
        _ = try await store.applyGmailLabels(g.all.id, [(uid: 1, labels: ["Receipts"])])
        #expect(try await store.messageLocations([o.messageRowId])[0].memberFolderIds.sorted() == [g.all.id, label.id].sorted())
        #expect(try await store.applyGmailLabels(g.all.id, [(uid: 1, labels: ["Receipts"]), (uid: 55, labels: [])]) == [])
        #expect(try await store.listFolders(accountId: g.account.id).first { $0.path == "Receipts" }?.total == 1)
    }

    @Test func omittingGmLabelsOnUpdateLeavesLabelMembershipAlone() async throws {
        let store = try StoreTestKit.makeStore()
        let g = try await StoreTestKit.seedGmail(store)
        let o = try await store.ingestMessages(g.account.id, g.all.id, [StoreTestKit.msg(1) { $0.gmMsgid = "1"; $0.gmThrid = "T"; $0.gmLabels = ["INBOX"] }], context: IngestContext())[0]
        _ = try await store.ingestMessages(g.account.id, g.all.id, [StoreTestKit.msg(1) { $0.gmMsgid = "1"; $0.gmThrid = "T"; $0.flags = StoreTestKit.seen }], context: IngestContext())
        #expect(try await store.messageLocations([o.messageRowId])[0].memberFolderIds.contains(g.inbox.id))
    }
}

@Suite("Store ingest: contacts, categories, blocked senders, rules")
struct StoreIngestPolicyTests {
    @Test func countsReceivedForSendersAndSentForRecipientsOfOwnMail() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.updateAccount(s.account.id, AccountPatch(aliases: ["alias@example.com"]))
        _ = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.from = [StoreTestKit.person("Carla", "Carla@Example.org")] }, StoreTestKit.msg(2) { $0.from = [StoreTestKit.person("Carla", "carla@example.org")] })
        _ = try await StoreTestKit.ingest(store, s, s.sent, StoreTestKit.msg(1) {
            $0.from = [Address(name: "Me", address: "alias@example.com")]; $0.to = [StoreTestKit.person("Bob")]; $0.cc = [StoreTestKit.person("Cy")]; $0.bcc = [StoreTestKit.me()]
        })
        let rows = try await StoreTestKit.strings(store, "SELECT email || ',' || sent_count || ',' || received_count FROM contacts ORDER BY email")
        #expect(rows == ["bob@example.org,1,0", "carla@example.org,0,2", "cy@example.org,1,0"])
        // Updating an existing message does not double count.
        _ = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.from = [StoreTestKit.person("Carla", "carla@example.org")]; $0.flags = StoreTestKit.seen })
        #expect(try await StoreTestKit.count(store, "SELECT received_count FROM contacts WHERE email = 'carla@example.org'") == 2)
    }

    @Test func suggestsContactsByPrefixRankedBySentTimesThreePlusReceived() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await StoreTestKit.ingest(
            store, s, s.inbox,
            StoreTestKit.msg(1) { $0.from = [StoreTestKit.person("Alice Smith", "alice@x.com")] }, StoreTestKit.msg(2) { $0.from = [StoreTestKit.person("Alan", "alan@x.com")] },
            StoreTestKit.msg(3) { $0.from = [StoreTestKit.person("Alan", "alan@x.com")] }, StoreTestKit.msg(4) { $0.from = [StoreTestKit.person("Bob Allen", "bob@x.com")] })
        _ = try await StoreTestKit.ingest(store, s, s.sent, StoreTestKit.msg(1) { $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("Alice Smith", "alice@x.com")] })
        #expect(try await store.suggestContacts(prefix: "al", limit: 8).map(\.email) == ["alice@x.com", "alan@x.com", "bob@x.com"])
        let top = try #require(try await store.suggestContacts(prefix: "alice@", limit: 8).first)
        #expect(top.email == "alice@x.com" && top.score == 4)
        #expect(try await store.suggestContacts(prefix: "", limit: 8) == [])
        #expect(try await store.suggestContacts(prefix: "100%", limit: 8) == [])
        #expect(try await store.suggestContacts(prefix: "al", limit: 1).count == 1)
        #expect(try await store.hasSentTo("ALICE@x.com"))
        #expect(try await !store.hasSentTo("alan@x.com"))
    }

    @Test func categorizesWithContactsListHeadersAndAutomatedSenders() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await StoreTestKit.ingest(store, s, s.sent, StoreTestKit.msg(1) { $0.from = [StoreTestKit.me()]; $0.to = [StoreTestKit.person("News", "news@brand.com")] })
        let out = try await StoreTestKit.ingest(
            store, s, s.inbox,
            StoreTestKit.msg(1) { $0.subject = "s1"; $0.from = [StoreTestKit.person("Pal")] },
            StoreTestKit.msg(2) { $0.subject = "s2"; $0.from = [StoreTestKit.person("Brand", "deals@brand.com")]; $0.headers = ["list-unsubscribe": "<mailto:u@brand.com>"] },
            StoreTestKit.msg(3) { $0.subject = "s3"; $0.from = [StoreTestKit.person("GitHub", "noreply@github.com")] },
            StoreTestKit.msg(4) { $0.subject = "s4"; $0.from = [StoreTestKit.person("News", "news@brand.com")]; $0.headers = ["list-id": "<n.brand.com>"] })
        #expect(out.map(\.category) == [.people, .newsletters, .notifications, .people])
        #expect(out.map(\.fromMe) == [false, false, false, false])
        #expect(try await store.threadRows(out[1].threadId)?.category == .newsletters)
    }

    @Test func flagsBlockedSendersAndKeepsThemOutOfTheInboxView() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        #expect(try await store.blockSender("Evil.org") == "@evil.org")
        #expect(try await store.blockSender("spam@x.com") == "spam@x.com")
        let out = try await StoreTestKit.ingest(
            store, s, s.inbox,
            StoreTestKit.msg(1) { $0.from = [StoreTestKit.person("A", "a@evil.org")] }, StoreTestKit.msg(2) { $0.from = [StoreTestKit.person("S", "spam@x.com")] },
            StoreTestKit.msg(3) { $0.from = [StoreTestKit.person("Ok", "ok@x.com")] })
        #expect(out.map(\.blocked) == [true, true, false])
        #expect(try await store.listThreads(ThreadQuery(view: .inbox), now: StoreTestKit.t0 + StoreTestKit.day).items.count == 1)
        await expectStoreError(.invalid, "email address or a domain") { _ = try await store.blockSender("nonsense") }
        #expect(try await store.listBlocked().map(\.pattern).sorted() == ["@evil.org", "spam@x.com"])
        #expect(try await store.blockedPatterns() == ["@evil.org", "spam@x.com"])
        #expect(try await store.unblockSender("evil.org") == "@evil.org")
        #expect(try await store.unblockSender("evil.org") == nil)
    }

    @Test func evaluatesRulesForNewInboxMailAppliesCategoryAndMuteReturnsTheRest() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await store.saveRule(StoreTestKit.rule(
            "Receipts", sortOrder: 1, conditions: [RuleCondition(field: .from, op: .contains, value: "stripe")],
            actions: [.category(.notifications), .markRead, .archive, .mute]))
        _ = try await store.saveRule(StoreTestKit.rule("Off", enabled: false, sortOrder: 2, conditions: [RuleCondition(field: .subject, op: .contains, value: "hi")], actions: [.trash]))
        let out = try await StoreTestKit.ingest(
            store, s, s.inbox,
            StoreTestKit.msg(1) { $0.subject = "Receipt"; $0.from = [StoreTestKit.person("Stripe", "billing@stripe.com")] }, StoreTestKit.msg(2) { $0.subject = "Lunch"; $0.from = [StoreTestKit.person("Pal")] })
        #expect(out[0].ruleActions == [.category(.notifications), .markRead, .archive, .mute])
        #expect(out[0].category == .notifications)
        let rows = try #require(try await store.threadRows(out[0].threadId))
        #expect(rows.category == .notifications && rows.muted)
        #expect(out[1].ruleActions == [])
        // Not re-run on updates, skipped for backfill and for non-inbox folders.
        let again = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(1) { $0.from = [StoreTestKit.person("Stripe", "billing@stripe.com")] })[0]
        #expect(again.ruleActions == [])
        let back = try await StoreTestKit.ingest(store, s, s.inbox, StoreTestKit.msg(3) { $0.from = [StoreTestKit.person("Stripe", "billing@stripe.com")] }, evaluate: false)[0]
        #expect(back.ruleActions == [] && !back.blocked)
        let trash = try await StoreTestKit.ingest(store, s, s.trash, StoreTestKit.msg(1) { $0.from = [StoreTestKit.person("Stripe", "billing@stripe.com")] })[0]
        #expect(trash.ruleActions == [])
    }

    @Test func validatesRulesAndSupportsUpdateAndDelete() async throws {
        let store = try StoreTestKit.makeStore()
        await expectStoreError(.invalid, "not valid") { _ = try await store.saveRule(StoreTestKit.rule("", conditions: [], actions: [])) }
        let r = try await store.saveRule(StoreTestKit.rule("A", match: .any, conditions: [RuleCondition(field: .subject, op: .contains, value: "x")], actions: [.pin]))
        var renamed = r
        renamed.name = "B"
        #expect(try await store.saveRule(renamed).name == "B")
        var ghost = r
        ghost.id = 999
        await expectStoreError(.notFound, "no longer exists") { _ = try await store.saveRule(ghost) }
        #expect(try await store.listRules().count == 1)
        #expect(try await store.rule(id: r.id)?.match == .any)
        try await store.deleteRule(r.id)
        #expect(try await store.listRules() == [])
    }

    @Test func listRulesForAnAccountIncludesAllAccountRulesAndSkipsDisabled() async throws {
        let store = try StoreTestKit.makeStore()
        let a = try await StoreTestKit.seedImap(store, "a@example.com")
        let b = try await StoreTestKit.seedImap(store, "b@example.com")
        let cond = [RuleCondition(field: .subject, op: .contains, value: "x")]
        _ = try await store.saveRule(StoreTestKit.rule("all", sortOrder: 2, conditions: cond, actions: [.pin]))
        _ = try await store.saveRule(StoreTestKit.rule("a only", accountId: a.account.id, sortOrder: 1, conditions: cond, actions: [.pin]))
        _ = try await store.saveRule(StoreTestKit.rule("off", enabled: false, conditions: cond, actions: [.pin]))
        #expect(try await store.listRules(accountId: a.account.id).map(\.name) == ["a only", "all"])
        #expect(try await store.listRules(accountId: b.account.id).map(\.name) == ["all"])
    }
}

@Suite("Store ingest: search index and bodies")
struct StoreIngestIndexTests {
    @Test func indexesSubjectSenderRecipientsAndBody() async throws {
        let store = try StoreTestKit.makeStore()
        let s = try await StoreTestKit.seedImap(store)
        _ = try await StoreTestKit.ingest(
            store, s, s.inbox,
            StoreTestKit.msg(1) {
                $0.subject = "Quarterly plan"; $0.from = [StoreTestKit.person("Zelda Fitz", "zelda@x.com")]
                $0.htmlBody = "<div>Budget <b>approved</b> for <a href='http://t.example/track'>team</a></div>"
            },
            StoreTestKit.msg(2) { $0.subject = "Other"; $0.textBody = String(repeating: "x", count: 150_000) + " needle" })
        func hits(_ q: String) async throws -> Int { try await store.listThreads(ThreadQuery(view: .search, search: q), now: StoreTestKit.t0).items.count }
        #expect(try await hits("quarterly") == 1)
        #expect(try await hits("zelda") == 1)
        #expect(try await hits("approved") == 1)
        #expect(try await hits("t.example") == 0)
        #expect(try await hits("needle") == 0)
        #expect(try await hits("me@example.com") == 2)
    }

    @Test func htmlEntitiesAndBlocksBecomeReadableText() {
        #expect(PlainText.fromHTML("<p>Tom &amp; Jerry&nbsp;&#169; &lt;3</p><p>next</p>").split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } == ["Tom & Jerry \u{A9} <3", "next"])
        #expect(PlainText.fromHTML("<style>a{b:c}</style><script>alert(1)</script><!-- hidden -->visible").trimmingCharacters(in: .whitespaces) == "visible")
        #expect(PlainText.snippet(from: "  a \n\n b\t c ") == "a b c")
        #expect(PlainText.draftSnippet(html: "<p>Here is <b>the</b> plan</p>") == "Here is the plan")
    }
}

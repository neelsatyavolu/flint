@testable import Flint
import FlintModel
import Foundation
import Testing

@Suite("Receipt status text")
struct ReceiptStatusTextTests {
    private static let utc = TimeZone(identifier: "UTC") ?? .gmt
    private static let us = Locale(identifier: "en_US")
    /// 2026-10-14 15:52 UTC
    private static let noon = 1_791_993_120_000
    private static let now = Date(timeIntervalSince1970: Double(noon) / 1000)

    private func line(_ r: ReceiptRecipient, detail: ReceiptDetail? = nil) -> String {
        ReceiptStatusText.statusLine(r, detail: detail, now: Self.now, timeZone: Self.utc, locale: Self.us)
            .replacingOccurrences(of: "\u{202F}", with: " ")
    }

    @Test("priority order for a whole message is replied, opened, unknowable, sent, untracked")
    func summaryPriority() {
        func summary(_ statuses: [ReceiptStatus]) -> ReceiptStatus {
            let people = statuses.enumerated().map { ReceiptRecipient(email: "p\($0.offset)@x.example", status: $0.element) }
            return ReceiptStatusText.summary(of: ReceiptDetail(trackedId: 1, sentAt: 0, recipients: people, events: [])).status
        }
        #expect(summary([.sent, .unknowable, .opened, .replied]) == .replied)
        #expect(summary([.sent, .unknowable, .opened]) == .opened)
        #expect(summary([.sent, .unknowable]) == .unknowable)
        #expect(summary([.sent, .untracked]) == .sent)
        #expect(summary([.untracked, .untracked]) == .untracked)
        #expect(summary([]) == .untracked)
    }

    @Test("summary counts opened or replied, ignores untracked, and keeps the latest open")
    func summaryCounts() {
        let people = [
            ReceiptRecipient(email: "a@x.example", status: .opened, lastOpenAt: 500),
            ReceiptRecipient(email: "b@x.example", status: .replied, lastOpenAt: 900),
            ReceiptRecipient(email: "c@x.example", status: .sent),
            ReceiptRecipient(email: "me@x.example", status: .untracked),
        ]
        let s = ReceiptStatusText.summary(of: ReceiptDetail(trackedId: 1, sentAt: 0, recipients: people, events: []))
        #expect(s.opened == 2)
        #expect(s.total == 3)
        #expect(s.lastOpenAt == 900)
    }

    @Test("tones")
    func tones() {
        #expect(ReceiptStatusText.tone(.opened) == .ok)
        #expect(ReceiptStatusText.tone(.replied) == .ok)
        #expect(ReceiptStatusText.tone(.unknowable) == .warn)
        #expect(ReceiptStatusText.tone(.sent) == .muted)
        #expect(ReceiptStatusText.tone(.untracked) == .muted)
    }

    @Test("honest copy for the states that cannot be confirmed")
    func honestCopy() {
        #expect(line(ReceiptRecipient(email: "a@x.example", status: .sent)) == "No open detected")
        #expect(line(ReceiptRecipient(email: "a@x.example", status: .unknowable)) == "Can't confirm opens: Apple Mail Privacy Protection")
        #expect(line(ReceiptRecipient(email: "a@x.example", status: .untracked)) == "Receipts unavailable for this message")
    }

    @Test("opened shows the time, the mail app, the place and a forwarding hint from the first counted open")
    func openedLine() throws {
        let events = [
            ReceiptEvent(at: Self.noon - 5_000, email: "A@x.example", kind: .prefetch, client: "Mail Proxy", counted: false),
            ReceiptEvent(at: Self.noon - 3_000, email: "a@x.example", kind: .open, client: "Gmail", location: "Austin, US", counted: true),
            ReceiptEvent(at: Self.noon - 1_000, email: "a@x.example", kind: .open, client: "Outlook", counted: true),
        ]
        let detail = ReceiptDetail(trackedId: 1, sentAt: 0, recipients: [], events: events)
        let r = ReceiptRecipient(email: "a@x.example", status: .opened, firstOpenAt: Self.noon - 3_000)
        #expect(line(r, detail: detail) == "Opened 3:51 PM · Gmail · Austin, US")
        var forwarded = r
        forwarded.possiblyForwarded = true
        #expect(line(forwarded, detail: detail).hasSuffix("· may have been forwarded"))
        #expect(line(ReceiptRecipient(email: "a@x.example", status: .opened)) == "Opened")
    }

    @Test("an open from another day carries the date")
    func openedYesterday() {
        let r = ReceiptRecipient(email: "a@x.example", status: .opened, firstOpenAt: Self.noon - 2 * 86_400_000)
        #expect(line(r) == "Opened Oct 12, 3:52 PM")
    }

    @Test("replied")
    func replied() {
        #expect(line(ReceiptRecipient(email: "a@x.example", status: .replied, repliedAt: Self.noon)) == "Replied 3:52 PM")
        #expect(line(ReceiptRecipient(email: "a@x.example", status: .replied)) == "Replied")
    }

    @Test("marker: grey check when sent, accent double check once read, warning when unknowable")
    func marker() {
        let sent = ReceiptStatusText.marker(ReceiptSummary(opened: 0, total: 1, status: .sent))
        #expect(!sent.read && sent.tone == .muted && sent.text.isEmpty && sent.label == "Not opened yet")
        let some = ReceiptStatusText.marker(ReceiptSummary(opened: 2, total: 3, status: .opened))
        #expect(some.read && some.tone == .ok && some.text == "2/3" && some.label == "Opened by 2 of 3")
        let replied = ReceiptStatusText.marker(ReceiptSummary(opened: 0, total: 1, status: .replied))
        #expect(replied.read && replied.label == "Replied")
        let unknown = ReceiptStatusText.marker(ReceiptSummary(opened: 0, total: 2, status: .unknowable))
        #expect(!unknown.read && unknown.tone == .warn && unknown.label == "Can't confirm opens: Apple Mail Privacy Protection")
        let none = ReceiptStatusText.marker(ReceiptSummary(opened: 0, total: 3, status: .sent))
        #expect(none.label == "Not opened yet by any of 3")
    }

    @Test("timeline line says what each event was and flags the ones that did not count")
    func eventLine() {
        let open = ReceiptEvent(at: 0, email: "a@x.example", kind: .open, client: "Gmail", device: "iPhone", location: "Austin, US", counted: true)
        #expect(ReceiptStatusText.eventLine(open) == "Opened · Gmail · iPhone · Austin, US")
        let scan = ReceiptEvent(at: 0, email: "a@x.example", kind: .scanner, counted: false)
        #expect(ReceiptStatusText.eventLine(scan) == "Security scan · not counted")
        #expect(ReceiptStatusText.eventLabel(.prefetch) == "Image prefetch")
        #expect(ReceiptStatusText.eventLabel(.bot) == "Automated fetch")
        #expect(ReceiptStatusText.eventLabel(.duplicate) == "Repeat view")
        #expect(ReceiptStatusText.eventLabel(.`self`) == "You")
    }
}

@Suite("Receipt rows for a sent message")
struct ReceiptRowsTests {
    private let me = ["maya@northwind.example", "Maya.Okafor+work@gmail.com"]

    @Test("own address and alias on a tracked send are listed as untracked")
    func addsSelf() {
        let receipt = ReceiptDetail(trackedId: 7, sentAt: 0, recipients: [ReceiptRecipient(email: "tomas@x.example", status: .sent)], events: [])
        let rows = ReceiptRows.recipients(
            receipt: receipt, to: [Address(address: "tomas@x.example")], cc: [Address(name: "Maya", address: "MAYA@northwind.example"), Address(address: "mayaokafor@gmail.com")],
            selfAddresses: me)
        #expect(rows.map(\.email) == ["tomas@x.example", "MAYA@northwind.example", "mayaokafor@gmail.com"])
        #expect(rows.dropFirst().allSatisfy { $0.status == .untracked })
        #expect(rows[1].name == "Maya")
    }

    @Test("gmail dots and plus tags count as the same own address")
    func canonical() {
        let receipt = ReceiptDetail(trackedId: 7, sentAt: 0, recipients: [ReceiptRecipient(email: "tomas@x.example", status: .sent)], events: [])
        let rows = ReceiptRows.recipients(
            receipt: receipt, to: [Address(address: "tomas@x.example"), Address(address: "mayaokafor@gmail.com")], cc: [], selfAddresses: me)
        #expect(rows.count == 2)
        #expect(rows.last?.status == .untracked)
    }

    @Test("a send to yourself alone has no receipt row but still explains itself")
    func selfOnly() {
        let rows = ReceiptRows.recipients(receipt: nil, to: [Address(address: "maya@northwind.example")], cc: [], selfAddresses: me)
        #expect(rows.map(\.status) == [.untracked])
    }

    @Test("without a receipt and with other recipients nothing is claimed")
    func unknownOthers() {
        let rows = ReceiptRows.recipients(
            receipt: nil, to: [Address(address: "maya@northwind.example"), Address(address: "tomas@x.example")], cc: [], selfAddresses: me)
        #expect(rows.isEmpty)
    }

    @Test("no recipients means no rows")
    func empty() {
        #expect(ReceiptRows.recipients(receipt: nil, to: [], cc: [], selfAddresses: me).isEmpty)
    }
}

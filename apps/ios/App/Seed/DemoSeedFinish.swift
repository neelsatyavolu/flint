import FlintModel
import FlintService
import FlintStore
import Foundation

/// The parts of the demo that are not mail on a server: pinned and snoozed threads, drafts, a scheduled send and receipts
/// activity. They go through the same service calls the screens use.
enum DemoSeedFinish {
    static func apply(service: FlintService, store: GRDBStore, now: Date) async throws {
        let threads = try await inboxThreads(service)
        if let offsite = threads.first(where: { $0.subject == "Offsite logistics" }) {
            _ = try await service.setPinned([offsite.id], pinned: true)
        }
        if let chidi = threads.first(where: { $0.subject == "Sunday dinner?" }) {
            _ = try await service.setPinned([chidi.id], pinned: true)
        }
        if let logo = threads.first(where: { $0.subject == "Logo options v3" }) {
            _ = try await service.snooze([logo.id], until: tomorrow(at: 8, from: now))
        }
        try await makeDrafts(service: service, threads: threads)
        try await scheduleSend(service: service, now: now)
        try await DemoSeedReceipts.recordActivity(in: store, now: now)
    }

    private static func inboxThreads(_ service: FlintService) async throws -> [ThreadListItem] {
        try await service.listThreads(ThreadQuery(view: .inbox, limit: 200)).items
    }

    private static func makeDrafts(service: FlintService, threads: [ThreadListItem]) async throws {
        if let intro = threads.first(where: { $0.subject == "Intro: Maya and Ravi" }) {
            let detail = try await service.thread(id: intro.id)
            if let last = detail.messages.last {
                let draft = try await service.createDraft(.reply(messageId: last.id))
                _ = try await service.updateDraft(id: draft.id, DraftPatch(html: "<p>Thursday morning works. Nine o'clock?</p>"))
            }
        }
        if let lease = threads.first(where: { $0.subject == "Lease renewal for unit 4B" }) {
            let detail = try await service.thread(id: lease.id)
            if let last = detail.messages.last {
                let draft = try await service.createDraft(.reply(messageId: last.id))
                _ = try await service.updateDraft(id: draft.id, DraftPatch(html: "<p>Dear Mr. Park, I would like to renew for another twelve months.</p>"))
            }
        }
    }

    private static func scheduleSend(service: FlintService, now: Date) async throws {
        let draft = try await service.createDraft(.new(
            accountId: DemoAccount.work.id, to: [DemoPeople.priya], subject: "Send later copy, second pass",
            html: "<p>Hi Priya, second pass on the send later copy is attached to NW-214.</p><p>Maya</p>"))
        _ = try await service.sendDraft(id: draft.id, sendAt: tomorrow(at: 9, from: now))
    }

    static func tomorrow(at hour: Int, from now: Date) -> EpochMs {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let day = calendar.date(byAdding: .day, value: 1, to: now) ?? now
        let date = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
        return Int(date.timeIntervalSince1970 * 1000)
    }
}

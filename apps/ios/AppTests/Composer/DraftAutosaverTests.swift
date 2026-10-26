@testable import Flint
import FlintModel
import Foundation
import Testing

@MainActor
private final class SaveLog {
    var patches: [DraftPatch] = []
    var states: [DraftAutosaver.State] = []
    var failures = 0
    var inFlight = 0
    var maxInFlight = 0

    func save(_ patch: DraftPatch) async throws {
        inFlight += 1
        maxInFlight = max(maxInFlight, inFlight)
        defer { inFlight -= 1 }
        try await Task.sleep(for: .milliseconds(20))
        if failures > 0 {
            failures -= 1
            throw DraftAutosaver.SaveFailed()
        }
        patches.append(patch)
    }
}

@Suite("Composer: autosave", .serialized)
@MainActor
struct DraftAutosaverTests {
    private func make(_ log: SaveLog, delay: Duration = .milliseconds(30)) -> DraftAutosaver {
        DraftAutosaver(
            delay: delay, retryDelays: [.milliseconds(40), .milliseconds(40)], onState: { log.states.append($0) },
            save: { try await log.save($0) })
    }

    @Test("edits inside the debounce window become one save")
    func debounce() async throws {
        let log = SaveLog()
        let saver = make(log)
        saver.push(DraftPatch(subject: "Hi"))
        saver.push(DraftPatch(html: "<div>x</div>"))
        try await Task.sleep(for: .milliseconds(200))
        #expect(log.patches.count == 1)
        #expect(log.patches.first?.subject == "Hi" && log.patches.first?.html == "<div>x</div>")
        #expect(log.states == [.saving, .saved])
    }

    @Test("a later value for the same field wins")
    func laterWins() async throws {
        let log = SaveLog()
        let saver = make(log)
        saver.push(DraftPatch(subject: "a", signatureId: .some(1)))
        saver.push(DraftPatch(subject: "b", signatureId: .some(nil)))
        try await saver.flush()
        #expect(log.patches.count == 1)
        #expect(log.patches.first?.subject == "b")
        #expect(log.patches.first?.signatureId == .some(nil))
    }

    @Test("flush saves now and waits for the save")
    func flush() async throws {
        let log = SaveLog()
        let saver = make(log, delay: .seconds(60))
        saver.push(DraftPatch(subject: "now"))
        try await saver.flush()
        #expect(log.patches.map(\.subject) == ["now"])
        #expect(!saver.hasPending)
    }

    @Test("saves never overlap, and edits during a save go in the next one")
    func serialized() async throws {
        let log = SaveLog()
        let saver = make(log, delay: .milliseconds(1))
        saver.push(DraftPatch(subject: "one"))
        try await Task.sleep(for: .milliseconds(10))
        saver.push(DraftPatch(subject: "two"))
        try await saver.flush()
        #expect(log.maxInFlight == 1)
        #expect(log.patches.last?.subject == "two")
    }

    @Test("a failed save keeps its patch and retries")
    func retry() async throws {
        let log = SaveLog()
        log.failures = 1
        let saver = make(log)
        saver.push(DraftPatch(subject: "again"))
        try await Task.sleep(for: .milliseconds(300))
        #expect(log.patches.map(\.subject) == ["again"])
        #expect(log.states.contains(.failed))
        #expect(log.states.last == .saved)
    }

    @Test("flush throws while saving keeps failing, and the patch is kept")
    func flushFails() async {
        let log = SaveLog()
        log.failures = 10
        let saver = make(log)
        saver.push(DraftPatch(subject: "x"))
        await #expect(throws: DraftAutosaver.SaveFailed.self) { try await saver.flush() }
        #expect(saver.hasPending)
        saver.cancel()
        #expect(!saver.hasPending)
    }
}

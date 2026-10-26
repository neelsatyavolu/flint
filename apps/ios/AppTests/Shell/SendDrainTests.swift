@testable import Flint
import Testing

/// Finishing sends that fall due while the app has a little background time.
@Suite("SendDrain", .serialized)
@MainActor
struct SendDrainTests {
    /// A clock the fake sleep advances, and a queue of due times `runDue` reports.
    @MainActor final class World {
        var now: Int = 1_000_000
        var dueTimes: [Int]
        private(set) var ran: [Int] = []

        init(dueTimes: [Int]) { self.dueTimes = dueTimes }

        func runDue() async -> Int? {
            while let first = dueTimes.first, first <= now {
                ran.append(first)
                dueTimes.removeFirst()
            }
            return dueTimes.first
        }

        func sleep(_ duration: Duration) async { now += Int(duration.components.seconds * 1000) + Int(duration.components.attoseconds / 1_000_000_000_000_000) }
    }

    @Test("a send inside the undo window is waited for and sent")
    func sendsInsideWindow() async {
        let world = World(dueTimes: [1_000_000 + 10_000])
        let outcome = await SendDrain(budgetMs: 25_000).run(runDue: { await world.runDue() }, now: { world.now }, sleep: { await world.sleep($0) })
        #expect(world.ran == [1_010_000])
        #expect(outcome == .drained)
    }

    @Test("nothing due returns at once")
    func idle() async {
        let world = World(dueTimes: [])
        let outcome = await SendDrain(budgetMs: 25_000).run(runDue: { await world.runDue() }, now: { world.now }, sleep: { await world.sleep($0) })
        #expect(outcome == .drained && world.now == 1_000_000)
    }

    @Test("work beyond the budget is left for the foreground")
    func beyondBudget() async {
        let world = World(dueTimes: [1_000_000 + 60_000])
        let outcome = await SendDrain(budgetMs: 25_000).run(runDue: { await world.runDue() }, now: { world.now }, sleep: { await world.sleep($0) })
        #expect(world.ran.isEmpty)
        #expect(outcome == .deferred(until: 1_060_000))
    }

    @Test("several sends in a row are all sent")
    func several() async {
        let world = World(dueTimes: [1_002_000, 1_009_000, 1_040_000])
        let outcome = await SendDrain(budgetMs: 25_000).run(runDue: { await world.runDue() }, now: { world.now }, sleep: { await world.sleep($0) })
        #expect(world.ran == [1_002_000, 1_009_000])
        #expect(outcome == .deferred(until: 1_040_000))
    }
}

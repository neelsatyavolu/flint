@testable import Flint
import Foundation
import Testing

/// What a trip to the background does to the sync service and to the system background task.
@Suite("BackgroundCycle", .serialized)
@MainActor
struct BackgroundCycleTests {
    @MainActor final class FakeTasking: BackgroundTasking {
        private(set) var begun: [Int] = []
        private(set) var ended: [Int] = []
        var timeRemaining: TimeInterval { 30 }
        func begin(expiration: @escaping @MainActor () -> Void) -> Int {
            begun.append(begun.count + 1)
            return begun.count
        }
        func end(_ id: Int) { ended.append(id) }
    }

    /// A drain that waits until it is cancelled or released.
    @MainActor final class Gate {
        private var released = false
        func wait() async -> SendDrain.Outcome {
            while !released, !Task.isCancelled { try? await Task.sleep(for: .milliseconds(5)) }
            return .drained
        }
        func release() { released = true }
    }

    private func model(_ tasking: FakeTasking) -> AppModel { AppModel(mode: .live, backgroundTasking: tasking) }

    @Test("a cycle that stays in the background stops the service and ends its task")
    func staysAway() async {
        let tasking = FakeTasking()
        let model = model(tasking)
        await model.backgroundCycle(drain: { .drained }, stop: {})
        #expect(model.backgroundStops == 1)
        #expect(tasking.ended == [1])
    }

    @Test("coming back during the drain cancels it and leaves the service running")
    func comesBack() async {
        let tasking = FakeTasking()
        let model = model(tasking)
        let gate = Gate()
        let cycle = Task { await model.backgroundCycle(drain: { await gate.wait() }, stop: {}) }
        while tasking.begun.isEmpty { await Task.yield() }
        model.cancelBackgroundDrain()
        await cycle.value
        #expect(model.backgroundStops == 0)
        #expect(tasking.ended == [1])
    }

    @Test("a second cycle keeps its own background task when the first finishes")
    func overlapping() async {
        let tasking = FakeTasking()
        let model = model(tasking)
        let first = Gate()
        let second = Gate()
        let one = Task { await model.backgroundCycle(drain: { await first.wait() }, stop: {}) }
        while tasking.begun.count < 1 { await Task.yield() }
        model.cancelBackgroundDrain()
        let two = Task { await model.backgroundCycle(drain: { await second.wait() }, stop: {}) }
        while tasking.begun.count < 2 { await Task.yield() }
        await one.value
        #expect(tasking.ended == [1])
        second.release()
        await two.value
        #expect(tasking.ended == [1, 2])
        #expect(model.backgroundStops == 1)
    }
}

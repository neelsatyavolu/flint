@testable import Flint
import Testing

@Suite("ThreadStepper")
struct ThreadStepperTests {
    @Test("next and previous move one row and stop at the ends")
    func steps() {
        let ids = [10, 20, 30]
        #expect(ThreadStepper.target(in: ids, from: 20, delta: 1) == 30)
        #expect(ThreadStepper.target(in: ids, from: 20, delta: -1) == 10)
        #expect(ThreadStepper.target(in: ids, from: 30, delta: 1) == nil)
        #expect(ThreadStepper.target(in: ids, from: 10, delta: -1) == nil)
    }

    @Test("with nothing open, or a thread that is not in the list, the first row opens")
    func fromNothing() {
        #expect(ThreadStepper.target(in: [10, 20], from: nil, delta: 1) == 10)
        #expect(ThreadStepper.target(in: [10, 20], from: 99, delta: -1) == 10)
        #expect(ThreadStepper.target(in: [], from: nil, delta: 1) == nil)
    }
}

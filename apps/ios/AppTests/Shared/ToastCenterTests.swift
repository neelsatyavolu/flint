@testable import Flint
import Foundation
import Testing

@Suite("Toast centre")
@MainActor
struct ToastCenterTests {
    @Test("a new toast replaces the current one")
    func replaces() {
        let center = ToastCenter(duration: .seconds(30))
        center.show("First")
        center.show("Second", kind: .error)
        #expect(center.current?.message == "Second")
        #expect(center.current?.kind == .error)
        center.dismiss()
        #expect(center.current == nil)
    }

    @Test("an empty message shows nothing")
    func empty() {
        let center = ToastCenter()
        center.show("")
        #expect(center.current == nil)
    }

    @Test("it dismisses itself after the duration")
    func autoDismiss() async throws {
        let center = ToastCenter(duration: .milliseconds(40))
        center.show("Archived")
        try await Task.sleep(for: .milliseconds(250))
        #expect(center.current == nil)
    }

    @Test("an older timer does not dismiss a newer toast")
    func staleTimer() async throws {
        let center = ToastCenter(duration: .milliseconds(150))
        center.show("One")
        try await Task.sleep(for: .milliseconds(100))
        center.show("Two")
        try await Task.sleep(for: .milliseconds(100))
        #expect(center.current?.message == "Two")
    }

    @Test("undo runs once and closes the toast")
    func undo() async {
        let center = ToastCenter(duration: .seconds(30))
        var calls = 0
        center.show("Archived", undo: { calls += 1 })
        await center.performUndo()
        await center.performUndo()
        #expect(calls == 1)
        #expect(center.current == nil)
    }

    @Test("a toast without undo ignores performUndo")
    func noUndo() async {
        let center = ToastCenter(duration: .seconds(30))
        center.show("Muted")
        await center.performUndo()
        #expect(center.current?.message == "Muted")
    }
}

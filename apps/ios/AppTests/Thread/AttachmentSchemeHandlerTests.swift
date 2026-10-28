@testable import Flint
import Foundation
import Testing
import WebKit

/// A scheme task that records what it is told. `stopped` tasks must never hear anything.
private final class RecordingTask: NSObject, WKURLSchemeTask, @unchecked Sendable {
    let request: URLRequest
    private(set) var events: [String] = []
    var stopped = false
    private(set) var messagedAfterStop = false

    init(url: String) { request = URLRequest(url: URL(string: url)!) }

    private func record(_ event: String) {
        if stopped { messagedAfterStop = true }
        events.append(event)
    }

    func didReceive(_ response: URLResponse) { record("response") }
    func didReceive(_ data: Data) { record("data") }
    func didFinish() { record("finish") }
    func didFailWithError(_ error: any Error) { record("fail") }
}

private actor Gate {
    private var open = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if open { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func release() {
        open = true
        waiters.forEach { $0.resume() }
        waiters = []
    }
}

private struct LoadFailure: Error {}

@MainActor
@Suite("Attachment scheme handler")
struct AttachmentSchemeHandlerTests {
    private func settle() async { try? await Task.sleep(for: .milliseconds(150)) }

    private func make(gate: Gate, fails: Bool) -> AttachmentSchemeHandler {
        AttachmentSchemeHandler(types: [7: "image/png", 8: "text/html"]) { _ in
            await gate.wait()
            if fails { throw LoadFailure() }
            return Data([1, 2, 3])
        }
    }

    @Test("an image that loads is delivered whole")
    func delivers() async {
        let gate = Gate()
        let handler = make(gate: gate, fails: false)
        let task = RecordingTask(url: "flint-attachment://7")
        handler.webView(WKWebView(), start: task)
        await gate.release()
        await settle()
        #expect(task.events == ["response", "data", "finish"])
    }

    @Test("a failed load is reported once")
    func reportsFailure() async {
        let gate = Gate()
        let handler = make(gate: gate, fails: true)
        let task = RecordingTask(url: "flint-attachment://7")
        handler.webView(WKWebView(), start: task)
        await gate.release()
        await settle()
        #expect(task.events == ["fail"])
    }

    @Test("a stopped task is never messaged when the load later fails")
    func stoppedThenFails() async {
        let gate = Gate()
        let handler = make(gate: gate, fails: true)
        let task = RecordingTask(url: "flint-attachment://7")
        let web = WKWebView()
        handler.webView(web, start: task)
        task.stopped = true
        handler.webView(web, stop: task)
        await gate.release()
        await settle()
        #expect(task.events.isEmpty)
        #expect(!task.messagedAfterStop)
    }

    @Test("a stopped task is never messaged when the load later succeeds")
    func stoppedThenSucceeds() async {
        let gate = Gate()
        let handler = make(gate: gate, fails: false)
        let task = RecordingTask(url: "flint-attachment://7")
        let web = WKWebView()
        handler.webView(web, start: task)
        task.stopped = true
        handler.webView(web, stop: task)
        await gate.release()
        await settle()
        #expect(task.events.isEmpty)
    }

    @Test("types other than images are refused straight away")
    func refusesDocuments() {
        let handler = make(gate: Gate(), fails: false)
        let html = RecordingTask(url: "flint-attachment://8")
        handler.webView(WKWebView(), start: html)
        #expect(html.events == ["fail"])
        let unknown = RecordingTask(url: "flint-attachment://99")
        handler.webView(WKWebView(), start: unknown)
        #expect(unknown.events == ["fail"])
    }
}

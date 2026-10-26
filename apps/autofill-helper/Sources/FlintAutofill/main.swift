import AppKit
import FlintAutofillCore
import Foundation

// FlintAutofill: Flint's Accessibility helper. Commands arrive as JSON lines on stdin, events leave as JSON lines on stdout
// (packages/core/src/autofill/contract.ts). Codes and raw lines are never logged.
// `FlintAutofill --self-test` prints the Accessibility permission state without prompting and exits.

let version = "0.1.0"
var signalSources: [DispatchSourceSignal] = []

if CommandLine.arguments.contains("--self-test") {
    print("FlintAutofill \(version) protocol \(protocolVersion) accessibility_trusted=\(System.trusted()) secure_input=\(System.secureInput)")
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = Controller(version: version)

// stdin is read off the main thread; EOF means Flint is gone, so the helper exits too.
Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
        if line.utf8.count > 64 * 1024 { System.log("dropped an oversized line"); continue }
        if line.isEmpty { continue }
        do {
            let command = try Wire.decodeCommand(line)
            DispatchQueue.main.async { controller.handle(command) }
        } catch {
            System.log("ignored an unreadable command (\(line.utf8.count) bytes)")
        }
    }
    DispatchQueue.main.async { controller.shutdown() }
}

for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler { controller.shutdown() }
    source.resume()
    signalSources.append(source)
}

controller.start()
app.run()

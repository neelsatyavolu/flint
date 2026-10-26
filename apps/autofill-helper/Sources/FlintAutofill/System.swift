import AppKit
import ApplicationServices
import Carbon.HIToolbox
import FlintAutofillCore
import Foundation

/// Process-level guards and output.
enum System {
    static func trusted(prompt: Bool = false) -> Bool {
        // Prompting is only ever requested by Flint's main process through the request_permission command.
        AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": prompt] as CFDictionary)
    }
    static var secureInput: Bool { IsSecureEventInputEnabled() }
    static var screenLocked: Bool {
        let info = CGSessionCopyCurrentDictionary() as? [String: Any]
        return (info?["CGSSessionScreenIsLocked"] as? Bool) ?? false
    }
    static var nowMs: Double { Date().timeIntervalSince1970 * 1000 }

    /// Flint itself (the process that launched us, or any app with a Flint bundle id) is never autofilled by suggestion.
    static func isFlint(_ app: NSRunningApplication) -> Bool {
        app.processIdentifier == getppid() || (app.bundleIdentifier ?? "").hasPrefix("co.xanom.flint")
    }

    static func openAccessibilityPane() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") { NSWorkspace.shared.open(url) }
    }

    private static let outLock = NSLock()
    static func emit(_ event: Event) {
        outLock.lock(); defer { outLock.unlock() }
        FileHandle.standardOutput.write(Data(Wire.encodeLine(event).utf8))
    }
    /// Diagnostics only. Never pass codes, field text or raw protocol lines here.
    static func log(_ message: String) {
        FileHandle.standardError.write(Data("FlintAutofill: \(message)\n".utf8))
    }
}

import ApplicationServices
import CoreGraphics
import FlintAutofillCore
import Foundation

/// Fills a code by posting keyboard events with unicode strings, one character at a time, so React/Vue inputs see real
/// input events and split boxes auto-advance. The clipboard is never touched.
enum Typer {
    static let delayMicroseconds: useconds_t = 12_000

    /// Blocks until Control/Option/Command/Shift are released (the global shortcut is still held when it fires), up to `timeout` seconds.
    static func waitForModifierRelease(timeout: Double = 1.0) {
        let mask: CGEventFlags = [.maskControl, .maskAlternate, .maskCommand, .maskShift]
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline, !CGEventSource.flagsState(.combinedSessionState).intersection(mask).isEmpty { usleep(15_000) }
    }

    /// Runs on a background queue. Returns false as soon as an event cannot be created.
    static func type(_ keystrokes: [String]) -> Bool {
        let source = CGEventSource(stateID: .combinedSessionState)
        for key in keystrokes {
            let utf16 = Array(key.utf16)
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else { return false }
            for event in [down, up] {
                event.flags = []
                event.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            }
            down.post(tap: .cgSessionEventTap)
            up.post(tap: .cgSessionEventTap)
            usleep(delayMicroseconds)
        }
        return true
    }

    /// Fallback when typing fails: writes the value straight into the field(s). Returns whether anything was set.
    static func setValue(_ keystrokes: [String], into field: FocusedField) -> Bool {
        if field.boxes.count > 1 {
            var ok = true
            for (i, key) in keystrokes.enumerated() where i < field.boxes.count {
                ok = AXUIElementSetAttributeValue(field.boxes[i], kAXValueAttribute as CFString, key as CFString) == .success && ok
            }
            return ok
        }
        guard AX.isSettable(field.element, kAXValueAttribute as String) else { return false }
        return AXUIElementSetAttributeValue(field.element, kAXValueAttribute as CFString, keystrokes.joined() as CFString) == .success
    }
}

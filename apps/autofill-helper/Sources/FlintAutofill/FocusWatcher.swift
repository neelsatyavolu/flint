import AppKit
import ApplicationServices
import FlintAutofillCore

/// Watches the frontmost app's focused element. Runs only while Flint holds a waiting code.
/// While running it also turns on web accessibility in Chromium based browsers and Electron apps
/// (AXManualAccessibility, falling back to AXEnhancedUserInterface), once per app, and only when the app had it off.
/// It puts back exactly what it changed when the watcher stops (no code is waiting any more), so those apps are not slowed the
/// rest of the time and an assistive tool that already enabled the flag keeps it. What it changed is journaled in the temp
/// directory, so a helper that was killed or crashed restores it on its next launch.
final class FocusWatcher {
    var onChange: ((FocusedField?) -> Void)?

    private var app: NSRunningApplication?
    private var appElement: AXUIElement?
    private var observer: AXObserver?
    private var poll: Timer?
    private var activation: NSObjectProtocol?
    /// Attribute Flint switched on per pid. Persists across app switches until stop().
    private var touched: [pid_t: String] = [:]
    private var lastElement: AXUIElement?
    private var last: FocusedField?
    private var running = false
    private var chromiumCache: [String: Bool] = [:]

    var isRunning: Bool { running }

    func start() {
        guard !running else { return }
        running = true
        activation = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] note in
            self?.bind(note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
        }
        // Short poll as a fallback for apps that do not post focus notifications, and to follow the field on scroll and resize.
        let timer = Timer(timeInterval: 0.4, repeats: true) { [weak self] _ in self?.tick() }
        timer.tolerance = 0.1
        RunLoop.main.add(timer, forMode: .common)
        poll = timer
        bind(NSWorkspace.shared.frontmostApplication)
    }

    func stop() {
        guard running else { return }
        running = false
        if let a = activation { NSWorkspace.shared.notificationCenter.removeObserver(a) }
        activation = nil
        poll?.invalidate(); poll = nil
        unbind()
        restoreWebAccessibility()
        publish(nil)
    }

    /// One-off read of the frontmost app's focused field (used by the shortcut). Does not require the watcher to run.
    func queryFocused(allowFlint: Bool) -> FocusedField? {
        guard let front = NSWorkspace.shared.frontmostApplication, allowFlint || !System.isFlint(front) else { return nil }
        let element = AXUIElementCreateApplication(front.processIdentifier)
        guard let focused = AX.element(element, kAXFocusedUIElementAttribute as String) else { return nil }
        return FieldReader.read(focused, pid: front.processIdentifier)
    }

    // MARK: binding

    private func bind(_ newApp: NSRunningApplication?) {
        unbind()
        publish(nil)
        guard let newApp, !System.isFlint(newApp), newApp.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return }
        app = newApp
        let element = AXUIElementCreateApplication(newApp.processIdentifier)
        appElement = element
        enableWebAccessibility(newApp, element)

        var created: AXObserver?
        let callback: AXObserverCallback = { _, _, _, refcon in
            guard let refcon else { return }
            Unmanaged<FocusWatcher>.fromOpaque(refcon).takeUnretainedValue().tick()
        }
        if AXObserverCreate(newApp.processIdentifier, callback, &created) == .success, let created {
            AXObserverAddNotification(created, element, kAXFocusedUIElementChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque())
            CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(created), .commonModes)
            observer = created
        }
        tick()
    }

    private func unbind() {
        if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes) }
        observer = nil
        app = nil; appElement = nil; lastElement = nil
    }

    private static let chromiumPrefixes = ["com.google.Chrome", "com.microsoft.edgemac", "company.thebrowser", "com.brave.Browser", "org.chromium", "com.vivaldi", "com.operasoftware"]

    private func needsManualAccessibility(_ app: NSRunningApplication) -> Bool {
        let id = app.bundleIdentifier ?? ""
        if id.hasPrefix("com.apple.") || id.hasPrefix("org.mozilla") { return false }
        if Self.chromiumPrefixes.contains(where: id.hasPrefix) { return true }
        if let cached = chromiumCache[id], !id.isEmpty { return cached }
        var result = false
        if let frameworks = app.bundleURL?.appendingPathComponent("Contents/Frameworks").path,
           let names = try? FileManager.default.contentsOfDirectory(atPath: frameworks) {
            result = names.contains { $0 == "Electron Framework.framework" || $0 == "Chromium Embedded Framework.framework" || $0.hasSuffix("Browser Framework.framework") }
        }
        if !id.isEmpty { chromiumCache[id] = result }
        return result
    }

    private static let manualAttr = "AXManualAccessibility", enhancedAttr = "AXEnhancedUserInterface"

    private static func isOn(_ element: AXUIElement, _ name: String) -> Bool {
        (AX.attr(element, name) as? Bool) ?? false
    }

    private func enableWebAccessibility(_ app: NSRunningApplication, _ element: AXUIElement) {
        let pid = app.processIdentifier
        guard needsManualAccessibility(app), touched[pid] == nil else { return }
        // Already on (VoiceOver or another assistive tool turned it on): leave it alone and never switch it off.
        if Self.isOn(element, Self.manualAttr) || Self.isOn(element, Self.enhancedAttr) { return }
        for name in [Self.manualAttr, Self.enhancedAttr] where AXUIElementSetAttributeValue(element, name as CFString, kCFBooleanTrue) == .success {
            touched[pid] = name
            Self.writeJournal(touched)
            return
        }
    }

    private func restoreWebAccessibility() {
        for (pid, name) in touched { Self.setOff(pid: pid, name: name) }
        touched = [:]
        Self.writeJournal([:])
    }

    private static func setOff(pid: pid_t, name: String) {
        guard NSRunningApplication(processIdentifier: pid) != nil else { return }
        AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), name as CFString, kCFBooleanFalse)
    }

    // MARK: journal (restores accessibility mode after a kill or crash)

    private static var journalURL: URL { URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("flint-autofill-ax-journal.json") }

    private static func writeJournal(_ entries: [pid_t: String]) {
        if entries.isEmpty { try? FileManager.default.removeItem(at: journalURL); return }
        let strings = Dictionary(uniqueKeysWithValues: entries.map { (String($0.key), $0.value) })
        if let data = try? JSONEncoder().encode(strings) { try? data.write(to: journalURL, options: .atomic) }
    }

    /// Called once at launch: puts back anything a previous helper switched on and did not get to restore.
    static func restoreFromJournal() {
        guard let data = try? Data(contentsOf: journalURL), let entries = try? JSONDecoder().decode([String: String].self, from: data) else { return }
        for (pid, name) in entries {
            guard let pid = pid_t(pid), name == manualAttr || name == enhancedAttr else { continue }
            let element = AXUIElementCreateApplication(pid)
            if isOn(element, name) { setOff(pid: pid, name: name) }
        }
        writeJournal([:])
    }

    // MARK: reading

    fileprivate func tick() {
        guard running, let app, let appElement else { return }
        if System.screenLocked { publish(nil); return }
        guard let focused = AX.element(appElement, kAXFocusedUIElementAttribute as String), let frame = AX.frame(focused) else {
            lastElement = nil; publish(nil); return
        }
        if let lastElement, CFEqual(lastElement, focused), var cached = last {
            if cached.frame != frame { cached.frame = frame; publish(cached) }
            return
        }
        lastElement = focused
        publish(FieldReader.read(focused, pid: app.processIdentifier))
    }

    private func publish(_ field: FocusedField?) {
        last = field
        onChange?(field)
    }
}

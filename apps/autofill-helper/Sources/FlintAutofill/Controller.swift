import AppKit
import FlintAutofillCore

/// Owns the helper's state: the waiting codes, permission, the suggestion panel and fills. All on the main thread.
final class Controller {
    let version: String
    private var codes: [HelperCode] = []
    private var trusted = System.trusted()
    private let watcher = FocusWatcher()
    private let panel = SuggestionPanel()
    private var current: FocusedField?
    private var dismissed: AXUIElement?
    private var observing = false
    private var demo: (field: ScreenRect, code: HelperCode)?
    private var permissionTimer: Timer?
    private var expiryTimer: Timer?
    private var activationObserver: NSObjectProtocol?
    private var filling = false

    init(version: String) { self.version = version }

    func start() {
        // One cap for every AX call this process makes, so a hung app cannot freeze the main thread for seconds.
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.25)
        if trusted { FocusWatcher.restoreFromJournal() }
        watcher.onChange = { [weak self] field in self?.focusChanged(field) }
        panel.onPick = { [weak self] code in self?.pick(code) }
        // Idle cost: one coarse timer that notices the user granting or revoking Accessibility.
        let timer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in self?.checkPermission() }
        timer.tolerance = 1
        RunLoop.main.add(timer, forMode: .common)
        permissionTimer = timer
        // The sample suggestion belongs to the Flint window it points at: it goes away as soon as another app comes forward.
        activationObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] note in
            guard let self, self.demo != nil, let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication, !System.isFlint(app) else { return }
            self.endDemo()
        }
        System.emit(.ready(protocol: protocolVersion, version: version, pid: Int(ProcessInfo.processInfo.processIdentifier), trusted: trusted))
    }

    func shutdown() {
        watcher.stop(); panel.hide()
        exit(0)
    }

    // MARK: commands

    func handle(_ command: Command) {
        switch command {
        case .status: System.emit(.permission(trusted: trusted))
        case .requestPermission(let openPane):
            _ = System.trusted(prompt: true)
            if openPane { System.openAccessibilityPane() }
            checkPermission(force: true)
        case .codes(let list):
            codes = list.filter { $0.expiresAt > System.nowMs }
            refreshObserving()
            scheduleExpiry()
            // A code that arrived, was used elsewhere or expired changes what an already visible suggestion should offer.
            if observing { focusChanged(current) }
        case .typeNewest: typeNewest()
        case .demo(let field, let code, let service):
            demo = (field, HelperCode(id: "demo", code: code, service: service, senderDomain: "", receivedAt: System.nowMs, expiresAt: System.nowMs + 600_000))
            panel.show(codes: [demo!.1], field: field)
        case .demoStop: endDemo()
        case .shutdown: shutdown()
        }
    }

    private func endDemo() {
        demo = nil; panel.hide()
        if observing { focusChanged(current) }
    }

    // MARK: permission and observation

    private func checkPermission(force: Bool = false) {
        let now = System.trusted()
        if now != trusted || force { trusted = now; System.emit(.permission(trusted: now)) }
        refreshObserving()
    }

    private func refreshObserving() {
        let want = trusted && !codes.isEmpty
        if want != observing {
            observing = want
            if want { watcher.start() } else { watcher.stop() }
            System.emit(.observing(active: want))
        }
        // The sample suggestion is not tied to a waiting code, so only a real one is hidden here.
        if !want && demo == nil { panel.hide() }
    }

    private func scheduleExpiry() {
        expiryTimer?.invalidate(); expiryTimer = nil
        guard let next = codes.map(\.expiresAt).min() else { return }
        let timer = Timer(timeInterval: max(0.5, (next - System.nowMs) / 1000 + 0.2), repeats: false) { [weak self] _ in
            guard let self else { return }
            self.codes = self.codes.filter { $0.expiresAt > System.nowMs }
            self.refreshObserving(); self.scheduleExpiry()
            if self.observing { self.focusChanged(self.current) }
        }
        RunLoop.main.add(timer, forMode: .common)
        expiryTimer = timer
    }

    // MARK: suggestion

    private func focusChanged(_ field: FocusedField?) {
        if let previous = current, let field, !CFEqual(previous.element, field.element) { dismissed = nil }
        current = field
        if demo != nil { return }
        guard observing, let field, !System.secureInput, !System.screenLocked else { panel.hide(); return }
        if let dismissed, CFEqual(dismissed, field.element) { panel.hide(); return }
        if case .notCodeField = field.verdict { panel.hide(); return }
        // A field scrolled out of view or clipped reports a frame outside its window: do not float over other content.
        if let window = field.windowFrame, !Geometry.isVisible(field: field.frame, in: window) { panel.hide(); return }
        let ranked = CodeRanking.rank(codes, now: System.nowMs, pageHost: field.pageHost)
        guard !ranked.isEmpty else { panel.hide(); return }
        panel.show(codes: ranked, field: field.frame)
    }

    // MARK: filling

    private func pick(_ code: HelperCode) {
        if code.id == "demo" {
            // The sample code only goes into Flint's own sample field.
            guard let front = NSWorkspace.shared.frontmostApplication, System.isFlint(front) else { endDemo(); return }
            fill(code, via: .demo, field: watcher.queryFocused(allowFlint: true)); return
        }
        fill(code, via: .suggestion, field: current)
    }

    /// The shortcut types into a focused field even when it was not recognised as a code field, but never into Flint itself,
    /// a secure or search field, a password/card style field, or a page whose address does not match the code's sender
    /// (there it shows the suggestion instead, so the person sees which service the code is from and confirms by clicking).
    private func typeNewest() {
        func fail(_ reason: FillFailure) { System.emit(.fillFailed(codeId: codes.first?.id ?? "", reason: reason)) }
        guard let field = watcher.queryFocused(allowFlint: false) else { return fail(.no_focus) }
        guard !field.forbidden else { return fail(.secure_input) }
        guard let code = CodeRanking.rank(codes, now: System.nowMs, pageHost: field.pageHost).first else { return fail(.expired) }
        if let host = field.pageHost, !CodeRanking.matches(senderDomain: code.senderDomain, pageHost: host) {
            current = field
            panel.show(codes: CodeRanking.rank(codes, now: System.nowMs, pageHost: host), field: field.frame)
            return
        }
        fill(code, via: .shortcut, field: field)
    }

    private func fill(_ code: HelperCode, via: FillVia, field: FocusedField?) {
        func fail(_ reason: FillFailure) { System.emit(.fillFailed(codeId: code.id, reason: reason)) }
        guard !filling else { return }
        guard trusted else { return fail(.no_permission) }
        guard !System.screenLocked else { return fail(.screen_locked) }
        guard !System.secureInput else { return fail(.secure_input) }
        // A code main already removed (used elsewhere) can still be on a stale panel: check it is still waiting.
        guard code.id == "demo" || codes.contains(where: { $0.id == code.id && $0.expiresAt > System.nowMs }) else { return fail(.expired) }
        guard let field else { return fail(.no_focus) }
        guard !field.forbidden else { return fail(.secure_input) }
        filling = true
        panel.hide()
        let keys = TypingPlan.keystrokes(for: code.code)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            if via == .shortcut { Typer.waitForModifierRelease() }
            let typed = Typer.type(keys)
            DispatchQueue.main.async {
                guard let self else { return }
                self.filling = false
                if typed || Typer.setValue(keys, into: field) {
                    System.emit(.used(codeId: code.id, via: via, method: typed ? .typed : .ax_value))
                    if code.id != "demo" { self.codes.removeAll { $0.id == code.id }; self.refreshObserving() }
                    else { self.demo = nil }
                } else {
                    System.emit(.fillFailed(codeId: code.id, reason: .type_failed))
                }
            }
        }
    }
}

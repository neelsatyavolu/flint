import SwiftUI

/// Hardware-keyboard shortcuts, matching the desktop app: Cmd-N compose, Cmd-R reply, Shift-Cmd-R reply all, E archive,
/// J and K (or the arrow keys) for next and previous, Cmd-F search. They show in the iPad menu bar and the Cmd-hold overlay.
/// Letter keys are off while a sheet or the composer panel is up, so typing never triggers them.
struct FlintCommands: Commands {
    let model: AppModel

    private var ready: Bool { model.phase == .ready }
    private var hasThread: Bool { ready && model.openThread != nil }
    private var singleKeys: Bool { ready && model.singleKeyShortcutsActive }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button(String(localized: "New message", table: "Shell")) { model.startCompose() }
                .keyboardShortcut("n")
                .disabled(!ready)
        }
        CommandMenu(String(localized: "Mail", table: "Shell")) {
            Button(String(localized: "Reply", table: "Shell")) { Task { await model.replyToOpenThread(all: false) } }
                .keyboardShortcut("r")
                .disabled(!hasThread)
            Button(String(localized: "Reply all", table: "Shell")) { Task { await model.replyToOpenThread(all: true) } }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(!hasThread)
            Button(String(localized: "Archive", table: "Shell")) { Task { await model.archiveOpenThread() } }
                .keyboardShortcut("e", modifiers: [])
                .disabled(!hasThread || !singleKeys)
            Divider()
            Button(String(localized: "Next conversation", table: "Shell")) { Task { await model.stepThread(by: 1) } }
                .keyboardShortcut("j", modifiers: [])
                .disabled(!singleKeys)
            Button(String(localized: "Previous conversation", table: "Shell")) { Task { await model.stepThread(by: -1) } }
                .keyboardShortcut("k", modifiers: [])
                .disabled(!singleKeys)
        }
    }
}

/// The arrow keys as next and previous, as on the desktop. A menu item has one shortcut, so these live in the view tree.
struct ViewKeyShortcuts: View {
    @Environment(AppModel.self) private var model

    private var arrowsOn: Bool { model.phase == .ready && model.singleKeyShortcutsActive }

    var body: some View {
        ZStack {
            Button("") { Task { await model.stepThread(by: 1) } }.keyboardShortcut(.downArrow, modifiers: []).disabled(!arrowsOn)
            Button("") { Task { await model.stepThread(by: -1) } }.keyboardShortcut(.upArrow, modifiers: []).disabled(!arrowsOn)
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }
}

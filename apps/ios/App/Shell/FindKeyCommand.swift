import SwiftUI
import UIKit

/// Cmd-F for search. iPadOS reserves Cmd-F for its own Find command, which a SwiftUI shortcut cannot take over, so this is a
/// `UIKeyCommand` that asks to win over system behaviour. It holds first responder only while nothing else (a text field) does.
struct FindKeyCommand: UIViewControllerRepresentable {
    let action: @MainActor () -> Void

    func makeUIViewController(context: Context) -> FindKeyController { FindKeyController(action: action) }

    func updateUIViewController(_ controller: FindKeyController, context: Context) { controller.action = action }
}

final class FindKeyController: UIViewController {
    var action: @MainActor () -> Void

    init(action: @escaping @MainActor () -> Void) {
        self.action = action
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override var canBecomeFirstResponder: Bool { true }

    override var keyCommands: [UIKeyCommand]? {
        let command = UIKeyCommand(input: "f", modifierFlags: .command, action: #selector(openSearch))
        command.wantsPriorityOverSystemBehavior = true
        command.discoverabilityTitle = String(localized: "Search", table: "Shell")
        return [command]
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    @objc private func openSearch() { MainActor.assumeIsolated { action() } }
}

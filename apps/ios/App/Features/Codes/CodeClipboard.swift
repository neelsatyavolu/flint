import Foundation
import UIKit
import UniformTypeIdentifiers

/// Where a copied code goes. The system pasteboard keeps it on this device only and drops it after a minute, because a
/// one-time code has no business sitting in the clipboard (or Universal Clipboard) any longer than that.
@MainActor
protocol CodeClipboard: AnyObject {
    func copy(_ code: String)
}

@MainActor
final class SystemCodeClipboard: CodeClipboard {
    static let lifetime: TimeInterval = 60

    func copy(_ code: String) {
        UIPasteboard.general.setItems(
            [[UTType.plainText.identifier: code]],
            options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(Self.lifetime)])
    }
}

@MainActor
final class MemoryCodeClipboard: CodeClipboard {
    private(set) var copied: [String] = []
    func copy(_ code: String) { copied.append(code) }
}

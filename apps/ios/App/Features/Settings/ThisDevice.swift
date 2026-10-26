import UIKit

/// What to call the device in copy: "iPad" on an iPad, "iPhone" otherwise.
enum ThisDevice {
    static func name(isPad: Bool) -> String { isPad ? "iPad" : "iPhone" }

    @MainActor static var name: String { name(isPad: UIDevice.current.userInterfaceIdiom == .pad) }
}

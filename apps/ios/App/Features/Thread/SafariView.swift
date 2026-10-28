import SwiftUI

/// A link opened in Safari's in-app view (no Flint data goes with it, and it shares no cookies with the reader). The view
/// controller comes from the lazily loaded `FlintLazyWeb.framework` (see `LazyWeb`).
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIViewController {
        LazyWeb.safariController(for: url) ?? UIViewController()
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {}
}

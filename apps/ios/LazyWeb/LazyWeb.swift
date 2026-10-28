import AuthenticationServices
import QuickLook
import SafariServices
import UIKit

/// The only code that links SafariServices, AuthenticationServices and QuickLook. Linked into the app, SafariServices and QuickLook
/// each add about 150 ms to every launch (measured with an empty app on the iOS 26.5 simulator; they share most of that cost), for
/// screens most launches never open. This framework is
/// embedded but not linked: the app loads it the first time it needs a link or a Google sign-in (`App/Shell/LazyWeb.swift`), and
/// reaches it by class name and selector, so nothing here is a compile-time dependency of the app.
///
/// Result codes of `authenticate`: 0 the callback URL arrived, 1 the person closed the sheet, 2 anything else.
@objc(FlintLazyWeb)
public final class LazyWeb: NSObject, ASWebAuthenticationPresentationContextProviding {
    @MainActor private static var running: LazyWeb?
    private var session: ASWebAuthenticationSession?

    /// Safari's in-app view for a link. No Flint data goes with it, and it shares no cookies with the reader.
    @MainActor @objc(safariControllerForURL:)
    public static func safariController(for url: NSURL) -> UIViewController {
        // SFSafariViewController raises for any scheme but http and https.
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return UIViewController() }
        let configuration = SFSafariViewController.Configuration()
        configuration.entersReaderIfAvailable = false
        return SFSafariViewController(url: url as URL, configuration: configuration)
    }

    /// Runs the Google sign-in page in `ASWebAuthenticationSession` (never a web view: Google refuses those). The session is not
    /// ephemeral, so Google remembers the person between sign-ins. `request` holds `url` (NSURL) and `scheme` (NSString).
    @MainActor @objc(authenticate:completion:)
    public static func authenticate(_ request: NSDictionary, completion: @escaping @convention(block) (NSURL?, Int) -> Void) {
        guard let url = request["url"] as? URL, let scheme = request["scheme"] as? String else { return completion(nil, 2) }
        let runner = LazyWeb()
        let session = ASWebAuthenticationSession(url: url, callback: .customScheme(scheme)) { callback, error in
            let code = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin ? 1 : 2
            Task { @MainActor in
                running = nil
                if let callback { completion(callback as NSURL, 0) } else { completion(nil, code) }
            }
        }
        session.presentationContextProvider = runner
        session.prefersEphemeralWebBrowserSession = false
        runner.session = session
        running = runner
        if !session.start() {
            running = nil
            completion(nil, 2)
        }
    }

    /// Quick Look for a downloaded attachment, presented over whatever is on top. Quick Look draws its own Done and Share buttons.
    @MainActor @objc(presentPreviewForURL:)
    public static func presentPreview(for url: NSURL) {
        let source = PreviewSource(url: url as URL)
        let controller = QLPreviewController()
        controller.dataSource = source
        controller.delegate = source
        previewSource = source
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
        var top = scene?.keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        top?.present(controller, animated: true)
    }

    @MainActor private static var previewSource: PreviewSource?

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            guard let scene else { return UIWindow(frame: .zero) }
            return scene.keyWindow ?? ASPresentationAnchor(windowScene: scene)
        }
    }
}

@MainActor
private final class PreviewSource: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    private let url: URL
    init(url: URL) { self.url = url }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem { url as NSURL }
}

@testable import Flint
import Foundation
import Testing
import UIKit

@Suite("Lazy web framework")
@MainActor
struct LazyWebTests {
    @Test("the embedded framework loads on demand and hands back Safari's view controller")
    func safariControllerComesFromTheEmbeddedFramework() throws {
        let controller = try #require(LazyWeb.safariController(for: URL(string: "https://example.com")!))
        #expect(String(describing: type(of: controller)) == "SFSafariViewController")
    }

    @Test("the app does not link the frameworks the lazy one carries")
    func appDoesNotLinkTheHeavyFrameworks() throws {
        // Linking SafariServices, QuickLook or AuthenticationServices costs about 150 ms of every launch. A debug build keeps the
        // load commands in Flint.debug.dylib, so look at the executable and that file.
        let bundle = Bundle(for: AppModel.self)
        let urls = [bundle.executableURL, bundle.url(forResource: "Flint.debug", withExtension: "dylib")].compactMap { $0 }
        #expect(!urls.isEmpty)
        for url in urls {
            let image = try Data(contentsOf: url, options: .alwaysMapped)
            for framework in ["SafariServices", "QuickLook", "AuthenticationServices"] {
                let path = Data("/\(framework).framework/\(framework)".utf8)
                #expect(image.range(of: path) == nil, "\(url.lastPathComponent) links \(framework)")
            }
        }
    }
}

import Foundation
import WebKit

/// The only script the reader runs. It is a `WKUserScript` in an isolated content world, so the mail's own scripts (which are
/// disabled and stripped anyway) can never see it. It adapts colors with the bundled `mailDark` adapter, fits wide mail to the
/// screen, reports the page height, and turns link taps into messages for the app.
enum ReaderScript {
    static let worldName = "co.xanom.flint.reader"
    static let handlerName = "flint"

    /// Messages the script posts.
    enum Message: Equatable {
        case height(CGFloat)
        case verdict(adaptable: Bool)
        case link(href: String, text: String)

        init?(_ body: Any) {
            guard let dict = body as? [String: Any], let kind = dict["t"] as? String else { return nil }
            switch kind {
            case "height":
                guard let value = (dict["v"] as? NSNumber)?.doubleValue, value.isFinite else { return nil }
                self = .height(CGFloat(value))
            case "verdict":
                guard let adaptable = dict["adaptable"] as? Bool else { return nil }
                self = .verdict(adaptable: adaptable)
            case "link":
                guard let href = dict["href"] as? String else { return nil }
                self = .link(href: href, text: (dict["text"] as? String) ?? "")
            default:
                return nil
            }
        }
    }

    @MainActor
    static var world: WKContentWorld { .world(name: worldName) }

    /// The adapter bundle then the runner, or the runner alone when the bundle is missing (colors stay as sent).
    @MainActor
    /// `textSizePercent` scales the message text for Dynamic Type (100 leaves it as sent).
    static func userScripts(textSizePercent: Int = 100) -> [WKUserScript] {
        let bundle = Bundle.main.url(forResource: "mailDark.bundle", withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
        let textSize = "document.documentElement.style.webkitTextSizeAdjust = '\(max(100, min(200, textSizePercent)))%';"
        let source = bundle + "\n" + textSize + "\n" + runner
        return [WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: world)]
    }

    static let runner = """
    (function () {
      var root = document.documentElement;
      var post = function (m) { try { window.webkit.messageHandlers.\(handlerName).postMessage(m); } catch (e) {} };
      var mode = root.getAttribute('data-adapt');
      if (mode !== 'none' && globalThis.flintMailDark) {
        try {
          var r = globalThis.flintMailDark.adapt(document.body.innerHTML);
          if (mode === 'force' || r.adaptable) { document.body.innerHTML = r.html; }
          else { root.setAttribute('data-sheet', 'light'); }
          if (mode === 'auto') { post({ t: 'verdict', adaptable: !!r.adaptable }); }
        } catch (e) { root.setAttribute('data-sheet', 'light'); }
      }
      root.removeAttribute('data-pending');
      var last = 0, lastWidth = -1;
      function fit() {
        var w = root.clientWidth;
        if (w === lastWidth) { return; }
        lastWidth = w;
        document.body.style.zoom = '';
        var sw = root.scrollWidth;
        if (w > 0 && sw > w + 1) { document.body.style.zoom = String(w / sw); }
      }
      function measure() {
        fit();
        var h = Math.ceil(document.body.getBoundingClientRect().height + 0.5);
        if (h !== last) { last = h; post({ t: 'height', v: h }); }
      }
      measure();
      if (window.ResizeObserver) { new ResizeObserver(measure).observe(document.body); }
      window.addEventListener('load', measure);
      document.addEventListener('click', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a) { return; }
        e.preventDefault();
        post({ t: 'link', href: a.getAttribute('href') || '', text: a.textContent || '' });
      }, true);
    })();
    """
}

// Entry point for the WKWebView dark-mode adapter. gen-maildark.sh bundles this file (and the desktop adapter it
// imports) into App/Resources/mailDark.bundle.js. The reader injects the bundle as a WKUserScript in its own
// WKContentWorld and calls `flintMailDark.adapt(html)`; the result is { html, adaptable, reasons }.
import { adaptMailForDark } from "../../desktop/src/renderer/src/lib/mailDark/index";

(globalThis as { flintMailDark?: unknown }).flintMailDark = {
  adapt: (html: string) => adaptMailForDark(html),
};

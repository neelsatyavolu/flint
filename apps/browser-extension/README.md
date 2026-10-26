# Flint verification codes (browser extension)

Suggests a verification code that just arrived in Flint when a page asks for one. Chromium browsers (Chrome, Arc, Brave, Edge, Vivaldi, Dia) and Firefox.

It talks only to the Flint app on this Mac, through native messaging (host `co.xanom.flint.codes`). No network requests, no remote code, no analytics. The only permission is `nativeMessaging`; the content script runs on http and https pages.

## Build

```sh
pnpm --filter @flint/browser-extension build   # writes dist/chromium and dist/firefox
pnpm --filter @flint/browser-extension test
```

## Load unpacked

Install the native messaging host first: Flint, Settings, Verification codes, Install. Then:

- Chromium browsers: open `chrome://extensions` (or the browser's equivalent), turn on Developer mode, choose "Load unpacked" and pick `dist/chromium`. The extension ID is fixed by the `key` in `manifest.chromium.json` (`gacbkfpccalfbcooobpoppipaaidlink`), which is what the host manifest allows.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose "Load Temporary Add-on" and pick `dist/firefox/manifest.json`. There is no signed Firefox build yet, so it has to be loaded again after each restart.

## How it works

- `fields.ts` finds code fields: `autocomplete="one-time-code"`, numeric inputs with maxlength 4 to 8, name/id/placeholder/label hints (code, otp, verification, 2fa, passcode, security code, token), and rows of 4 to 8 single-character boxes. Zip codes, card security codes and promo codes are excluded.
- `controller.ts` shows the suggestion when such a field gets focus: Enter fills, Esc dismisses, arrow keys pick among several codes. Dynamically added fields work because it listens for focus on the document.
- `ui.ts` draws it in a closed shadow root under the field (above it when there is no room), so page styles cannot touch it.
- `fill.ts` sets the value through the native setter and dispatches `input`, `change` and `keyup` so React and Vue forms notice.
- `rank.ts` puts codes whose sender's registrable domain matches the page first.
- `background.ts` is the only part that calls the native host. It ignores senders that are not this extension and derives the page origin itself. It keeps nothing between requests.

Icons are rendered from `icons/icon.svg` (the Flint mark from `site/public/favicon.svg`).

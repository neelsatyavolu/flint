// TEST ONLY. Replaces dist/chromium/background.js in a temp copy so a real browser can load the built extension
// without the native host. Never copied into dist/.
const codes = [
  { id: "t1", code: "530331", service: "KAYAK", senderDomain: "kayak.com", receivedAt: Date.now() },
  { id: "t2", code: "X67-UJK", service: "Slack", senderDomain: "slack.com", receivedAt: Date.now() - 1000 },
];
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;
  if (message && message.kind === "flint.codes.list") sendResponse({ ok: true, codes });
  else if (message && message.kind === "flint.codes.used") sendResponse({ ok: true });
});

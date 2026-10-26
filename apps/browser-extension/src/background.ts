import { HOST_NAME, type BackgroundReply, type NativeRequest, type WireCode } from "./protocol";
import { sanitizeCodes } from "./sanitize";

type HostResult = { ok: true; codes?: WireCode[] } | { ok: false; error: "not_running" | "disabled" | "no_host" | "failed" };

function callHost(request: NativeRequest): Promise<HostResult> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST_NAME, request, (reply) => {
        const err = chrome.runtime.lastError;
        if (err) {
          const msg = (err.message ?? "").toLowerCase();
          return resolve({ ok: false, error: /not found|forbidden|not allowed/.test(msg) ? "no_host" : "failed" });
        }
        const r = reply as { ok?: unknown; codes?: unknown; error?: { code?: unknown } } | null;
        if (!r || typeof r !== "object") return resolve({ ok: false, error: "failed" });
        if (r.ok === true) return resolve({ ok: true, codes: sanitizeCodes(r.codes) });
        const code = r.error?.code;
        resolve({ ok: false, error: code === "not_running" || code === "disabled" ? code : "failed" });
      });
    } catch {
      resolve({ ok: false, error: "failed" });
    }
  });
}

/** The origin of the page the person is on. Derived here from the sender, never taken from the content script. */
function originOf(sender: ExtSender): string {
  for (const url of [sender.tab?.url, sender.url]) {
    try {
      if (url) return new URL(url).origin;
    } catch {
      /* try the next */
    }
  }
  return "";
}

export async function handleMessage(message: unknown, sender: ExtSender, selfId: string | undefined): Promise<BackgroundReply | null> {
  if (!selfId || sender.id !== selfId || !sender.tab) return null;
  const m = message as { kind?: unknown; id?: unknown } | null;
  if (!m || typeof m !== "object") return null;
  if (m.kind === "flint.codes.list") {
    const origin = originOf(sender);
    return callHost({ type: "list", origin });
  }
  if (m.kind === "flint.codes.used" && typeof m.id === "string" && m.id.length > 0 && m.id.length <= 128) {
    const res = await callHost({ type: "used", id: m.id });
    return res.ok ? { ok: true } : res;
  }
  return null;
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void handleMessage(message, sender, chrome.runtime.id).then((reply) => {
      if (reply) sendResponse(reply);
    });
    return true;
  });
}

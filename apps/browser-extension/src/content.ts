import { startController } from "./controller";
import type { BackgroundReply, ContentRequest } from "./protocol";

function send(message: ContentRequest): Promise<BackgroundReply> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (reply) => {
        if (chrome.runtime.lastError || !reply || typeof reply !== "object") return resolve({ ok: false, error: "failed" });
        resolve(reply as BackgroundReply);
      });
    } catch {
      resolve({ ok: false, error: "failed" });
    }
  });
}

function hosts(): string[] {
  const out = [location.hostname];
  // When framed, the page the person sees is the top one.
  const top = location.ancestorOrigins?.[location.ancestorOrigins.length - 1];
  if (top) {
    try {
      out.push(new URL(top).hostname);
    } catch {
      /* ignore */
    }
  }
  return out;
}

startController({
  doc: document,
  fetchCodes: () => send({ kind: "flint.codes.list" }),
  markUsed: (id) => void send({ kind: "flint.codes.used", id }),
  hosts,
});

import type { Address, MessageView, ThreadDetail } from "@flint/core";
import { formatAddress, formatFullDate, formatParticipants, pluralize } from "../../lib/format";
import { blockRemoteImages, buildCsp } from "../../lib/html";

/** Window event that prints the open conversation (File > Print, the reader's More menu). */
export const PRINT_EVENT = "flint:print";

export type PrintMessage = Pick<MessageView, "from" | "to" | "cc" | "date" | "html" | "text" | "remoteImages">;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const people = (list: Address[]) => escape(list.map(formatAddress).join(", "));

/** One message: who, when, then the body. core has already sanitized the HTML; blocked remote images stay blocked. */
function messageBlock(m: PrintMessage): string {
  const body =
    m.html !== null
      ? m.remoteImages === "allowed" ? m.html : blockRemoteImages(m.html)
      : `<div class="text">${escape(m.text ?? "")}</div>`;
  const rows = [
    `<div><b>From</b> ${people(m.from)}</div>`,
    m.to.length ? `<div><b>To</b> ${people(m.to)}</div>` : "",
    m.cc.length ? `<div><b>Cc</b> ${people(m.cc)}</div>` : "",
    `<div><b>Date</b> ${escape(formatFullDate(m.date))}</div>`,
  ].join("");
  return `<section class="msg"><header>${rows}</header><div class="body">${body}</div></section>`;
}

/**
 * A standalone, light document for printing a whole conversation: the subject, then every message expanded with its
 * from, to, cc and date. The CSP blocks scripts, forms and frames like the reader's mail frames do.
 */
export function buildPrintDocument(subject: string, messages: PrintMessage[]): string {
  const title = escape(subject || "(no subject)");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${buildCsp(true)}">
<title>${title}</title>
<style>
html{background:#fff;color-scheme:light}
body{margin:0;padding:24px;background:#fff;color:#1a1a17;font:13px/1.5 "Geist Variable",ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif;overflow-wrap:anywhere}
h1{margin:0 0 4px;font-size:20px;line-height:28px;font-weight:600}
.count{margin:0 0 16px;color:#5f5e58;font-size:12px}
.msg{padding:16px 0;border-top:1px solid #d9d7cf}
.msg header{margin-bottom:12px;color:#3d3c37;font-size:12px}
.msg header b{display:inline-block;min-width:40px;font-weight:600;color:#1a1a17}
.text{white-space:pre-wrap}
a{color:#2f6fe0}
img{max-width:100%;height:auto}
table{max-width:100%}
.flint-blocked-img{display:none}
@page{margin:16mm}
</style></head><body>
<h1>${title}</h1>
<p class="count">${pluralize(messages.length, "message")} · ${escape(formatParticipants(messages.flatMap((m) => m.from)))}</p>
${messages.map(messageBlock).join("\n")}
</body></html>`;
}

/** Fills in the bodies of messages the reader has not loaded yet (collapsed ones), so the print is complete. */
export async function withBodies(thread: ThreadDetail, load: (id: number) => Promise<MessageView>): Promise<MessageView[]> {
  return Promise.all(thread.messages.map((m) => (m.html === null && m.text === null && !m.bodyLoaded ? load(m.id) : m)));
}

/** Prints an HTML document from a hidden, script-free frame; macOS's print dialog offers Save as PDF. */
export function printDocument(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    // Same origin so the parent can call print(); no allow-scripts, so nothing in the mail can run.
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;";
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      frame.remove();
    };
    frame.addEventListener("load", () => {
      const win = frame.contentWindow;
      if (!win) {
        cleanup();
        reject(new Error("The print frame did not load."));
        return;
      }
      win.addEventListener("afterprint", cleanup);
      // print() blocks until the dialog closes in most engines; the timer covers the ones where it does not.
      setTimeout(cleanup, 5 * 60_000);
      try {
        win.focus();
        win.print();
        resolve();
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }, { once: true });
    frame.srcdoc = html;
    document.body.append(frame);
  });
}

/** Prints a whole conversation, loading any message bodies the reader has not fetched yet. */
export async function printThread(thread: ThreadDetail, load: (id: number) => Promise<MessageView>): Promise<void> {
  const messages = await withBodies(thread, load);
  await printDocument(buildPrintDocument(thread.subject, messages));
}

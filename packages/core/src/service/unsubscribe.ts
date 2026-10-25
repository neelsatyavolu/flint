import { parseUnsubscribe } from "../store";
import { logger } from "../log";
import { FlintError, type MessageRowId } from "../types";
import type { ServiceContext } from "./context";

const log = logger("service.unsubscribe");

type Method = "one_click" | "mailto" | "browser";

/** One-click POSTs come from the mail itself, so never send them to this machine or its network. */
export function isPublicHttpsUrl(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host.startsWith("[")) return false;
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}

async function oneClick(ctx: ServiceContext, url: string): Promise<boolean> {
  if (!isPublicHttpsUrl(url)) return false;
  try {
    const res = await ctx.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    // RFC 8058: any 2xx means the request was accepted.
    return res.status >= 200 && res.status < 300;
  } catch (error) {
    log.warn("one-click unsubscribe failed", { reason: (error as Error).message });
    return false;
  }
}

function parseMailto(raw: string): { to: string; subject: string; body: string } | null {
  try {
    const url = new URL(raw);
    const to = decodeURIComponent(url.pathname).trim();
    if (!to) return null;
    return { to, subject: url.searchParams.get("subject") ?? "unsubscribe", body: url.searchParams.get("body") ?? "unsubscribe" };
  } catch {
    return null;
  }
}

/** RFC 8058 one-click POST, else a mailto through the compose hook, else the system browser. */
export async function unsubscribe(ctx: ServiceContext, messageId: MessageRowId): Promise<{ method: Method }> {
  const msg = ctx.store.getMessage(messageId);
  if (!msg) throw new FlintError("not_found", "That message no longer exists.");
  const info = parseUnsubscribe(msg.headers);
  if (!info) throw new FlintError("not_found", "This message has no unsubscribe link.");

  if (info.oneClick && info.url && (await oneClick(ctx, info.url))) return { method: "one_click" };

  const mail = info.mailto ? parseMailto(info.mailto) : null;
  if (mail && ctx.compose.sendRaw) {
    await ctx.compose.sendRaw({ accountId: msg.accountId, to: [{ name: "", address: mail.to }], subject: mail.subject, text: mail.body });
    return { method: "mailto" };
  }
  const target = info.url ?? info.mailto;
  if (!target) throw new FlintError("invalid", "This message's unsubscribe address is not usable.");
  await ctx.platform.openExternal(target);
  return { method: "browser" };
}

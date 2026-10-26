/**
 * FROZEN CONTRACT between the extension's content script, its background worker and the Flint native host.
 * Mirrors packages/core/src/codes/contract.ts (WireCode, NativeRequest, NativeResponse); this package has no
 * dependency on @flint/core, so the shapes are repeated here. Keep them identical.
 *
 *   content script --runtime.sendMessage(ContentRequest)--> background --runtime.sendNativeMessage(HOST_NAME, NativeRequest)--> flint native-host
 *
 * Only the background worker may talk to the host (content scripts cannot use nativeMessaging). The background must
 * ignore messages whose sender.id is not its own extension and must build the NativeRequest itself (never forward
 * content-supplied objects). The page origin it sends is derived from sender.tab.url / sender.url, not trusted from content.
 */
export const HOST_NAME = "co.xanom.flint.codes";

/** A code as the host returns it. */
export type WireCode = { id: string; code: string; service: string; senderDomain: string; receivedAt: number };

export type NativeRequest =
  | { type: "ping" }
  | { type: "list"; origin: string }
  | { type: "used"; id: string };

export type NativeResponse =
  | { ok: true; codes?: WireCode[]; running?: boolean }
  | { ok: false; error: { code: "not_running" | "disabled" | "auth" | "invalid" | "internal"; message: string } };

export type ContentRequest =
  | { kind: "flint.codes.list" }
  | { kind: "flint.codes.used"; id: string };

/** What the background answers to the content script. `error` is a short reason, never shown to the page. */
export type BackgroundReply =
  | { ok: true; codes?: WireCode[] }
  | { ok: false; error: "not_running" | "disabled" | "no_host" | "failed" };

/** A code ready to show: ranked, with whether its sender matches the page. */
export type RankedCode = WireCode & { matchesSite: boolean };

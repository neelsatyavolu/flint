/**
 * FROZEN CONTRACTS for verification-code suggestions. Four areas build against this file; change it only by agreement.
 *
 *   mail arrives -> core detects a code (codes/detect.ts) -> CodeRegistry (memory, 10 min) -> event {type:"code"}
 *     -> desktop notification / clipboard / reader banner / thread chip
 *     -> codes.sock (JSON lines, token handshake) <- `flint native-host` (native messaging framing) <- browser extension
 *
 * Constants, the socket protocol and the native messaging schema live here so every side imports one definition.
 * The browser extension has no dependency on @flint/core, so apps/browser-extension/src/protocol.ts repeats the
 * native messaging types by hand; codes/contract.test.ts checks the shared constants against the extension manifests.
 */
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MAX_SOCKET_PATH_BYTES } from "../agent/paths";
import type { VerificationCode } from "../types";

// ---------- Identity ----------

/** Native messaging host name. Lower case, dots and underscores only (browser rule). */
export const CODES_HOST_NAME = "co.xanom.flint.codes";
/** Chromium extension ID derived from the public key in apps/browser-extension/manifest.chromium.json ("key"). */
export const CODES_EXTENSION_ID = "gacbkfpccalfbcooobpoppipaaidlink";
/** Chrome's allowed_origins entry for the host manifest. */
export const CODES_ALLOWED_ORIGIN = `chrome-extension://${CODES_EXTENSION_ID}/`;
/** Gecko add-on id (browser_specific_settings.gecko.id) and the host manifest's allowed_extensions entry. */
export const CODES_FIREFOX_ID = "flint-codes@xanom.co";

// ---------- Timing and limits ----------

/** A code is offered for 10 minutes after detection. */
export const CODE_TTL_MS = 10 * 60_000;
/** Only mail dated within the last 15 minutes can produce a code (old mail synced later never does). */
export const CODE_MAX_AGE_MS = 15 * 60_000;
/** Auto-copy clears the clipboard after this long, only if it still holds the code. */
export const CODE_CLIPBOARD_CLEAR_MS = 90_000;
/** The registry keeps at most this many codes (oldest dropped). */
export const CODE_MAX_RECENT = 20;

// ---------- Filesystem layout (all derived from an injectable data dir) ----------

export const CODES_SOCKET_FILE = "codes.sock";
export const CODES_TOKEN_FILE = "codes-token";
/** Written next to the token when the socket had to move to a short path (AF_UNIX path limit). */
export const CODES_SOCKET_POINTER_FILE = "codes-socket-path";
/** Wrapper script the browsers launch as the native host; lives in the data dir. */
export const CODES_HOST_WRAPPER_FILE = "flint-native-host";

export type CodesPaths = { socketPath: string; tokenPath: string; pointerPath: string; wrapperPath: string };

/** <dataDir>/codes.sock, or /tmp-style flint-<hash>/codes.sock when that is too long for AF_UNIX. Sibling of agent.sock's fallback dir. */
export function codesPaths(dataDir: string, tmp: string = tmpdir()): CodesPaths {
  const inDir = join(dataDir, CODES_SOCKET_FILE);
  let socketPath = inDir;
  if (Buffer.byteLength(inDir) > MAX_SOCKET_PATH_BYTES) {
    const id = createHash("sha256").update(dataDir).digest("hex").slice(0, 8);
    const short = join(tmp, `flint-${id}`, CODES_SOCKET_FILE);
    socketPath = Buffer.byteLength(short) <= MAX_SOCKET_PATH_BYTES ? short : join("/tmp", `flint-${id}`, CODES_SOCKET_FILE);
  }
  return {
    socketPath,
    tokenPath: join(dataDir, CODES_TOKEN_FILE),
    pointerPath: join(dataDir, CODES_SOCKET_POINTER_FILE),
    wrapperPath: join(dataDir, CODES_HOST_WRAPPER_FILE),
  };
}

/** Where each browser looks for native messaging host manifests, relative to `home`. VERIFIED on this Mac: chrome, chromium, edge, vivaldi, arc, firefox. brave: standard Chromium layout. dia: best guess, not installed here. */
export const BROWSER_MANIFEST_DIRS: { id: import("../types").BrowserId; name: string; family: "chromium" | "firefox"; appSupport: string; hosts: string }[] = [
  { id: "chrome", name: "Google Chrome", family: "chromium", appSupport: "Google/Chrome", hosts: "Google/Chrome/NativeMessagingHosts" },
  { id: "chrome-beta", name: "Google Chrome Beta", family: "chromium", appSupport: "Google/Chrome Beta", hosts: "Google/Chrome Beta/NativeMessagingHosts" },
  { id: "chrome-canary", name: "Google Chrome Canary", family: "chromium", appSupport: "Google/Chrome Canary", hosts: "Google/Chrome Canary/NativeMessagingHosts" },
  { id: "chromium", name: "Chromium", family: "chromium", appSupport: "Chromium", hosts: "Chromium/NativeMessagingHosts" },
  { id: "brave", name: "Brave", family: "chromium", appSupport: "BraveSoftware/Brave-Browser", hosts: "BraveSoftware/Brave-Browser/NativeMessagingHosts" },
  { id: "edge", name: "Microsoft Edge", family: "chromium", appSupport: "Microsoft Edge", hosts: "Microsoft Edge/NativeMessagingHosts" },
  { id: "vivaldi", name: "Vivaldi", family: "chromium", appSupport: "Vivaldi", hosts: "Vivaldi/NativeMessagingHosts" },
  { id: "arc", name: "Arc", family: "chromium", appSupport: "Arc/User Data", hosts: "Arc/User Data/NativeMessagingHosts" },
  { id: "dia", name: "Dia", family: "chromium", appSupport: "Dia/User Data", hosts: "Dia/User Data/NativeMessagingHosts" },
  { id: "firefox", name: "Firefox", family: "firefox", appSupport: "Firefox", hosts: "Mozilla/NativeMessagingHosts" },
];
/** All of the above are under <home>/Library/Application Support. */
export const appSupportDir = (home: string = homedir()): string => join(home, "Library", "Application Support");

// ---------- codes.sock protocol (JSON lines, one object per line, UTF-8) ----------
//
// The server (core, service/codes) listens on codesPaths(dataDir).socketPath, mode 0600, in a 0700 directory, and
// reads the secret in tokenPath (created 0600 like agent-token, separate from it). Every connection must start with
// {"id":1,"op":"hello","token":"<token>"}; anything else gets {"ok":false,"error":{"code":"auth",...}} and a close.
// Requests carry a numeric `id`; the response repeats it. The server serves ONLY these ops.

/** What leaves the app toward the browser. Deliberately small: no thread, message or account ids. */
export type WireCode = Pick<VerificationCode, "id" | "code" | "service" | "senderDomain" | "receivedAt">;

export const wireCodeSchema = z.object({
  id: z.string(), code: z.string(), service: z.string(), senderDomain: z.string(), receivedAt: z.number(),
});

export const socketRequestSchema = z.discriminatedUnion("op", [
  z.object({ id: z.number().int(), op: z.literal("hello"), token: z.string().min(1).max(200) }),
  /** Valid codes (not expired, not used), newest first. `origin` is the page origin, informational only; ranking is the extension's job. */
  z.object({ id: z.number().int(), op: z.literal("list"), origin: z.string().max(2000).optional() }),
  z.object({ id: z.number().int(), op: z.literal("used"), codeId: z.string().min(1).max(100) }),
]);
export type SocketRequest = z.infer<typeof socketRequestSchema>;

export type SocketError = { code: "auth" | "invalid" | "not_found" | "disabled" | "internal"; message: string };
export type SocketResponse =
  | { id: number; ok: true; codes?: WireCode[] }       // codes present for "list"; hello and used reply {id, ok:true}
  | { id: number; ok: false; error: SocketError };

/** Max bytes of one request line; longer lines close the connection. */
export const SOCKET_MAX_LINE_BYTES = 8 * 1024;

// ---------- Native messaging (extension background <-> `flint native-host`) ----------
//
// Framing is the browser standard: 4-byte unsigned little-endian length, then that many bytes of UTF-8 JSON, on the
// host's stdin (from the browser) and stdout (to the browser). The host never writes anything else to stdout.
// Chrome caps a host-to-browser message at 1 MB and a browser-to-host message at 64 MiB; we stay far below both.

export const nativeRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("list"), origin: z.string().max(2000) }),
  z.object({ type: z.literal("used"), id: z.string().min(1).max(100) }),
]);
export type NativeRequest = z.infer<typeof nativeRequestSchema>;

/**
 * "ping" -> {ok:true, running:boolean}; "list" -> {ok:true, codes}; "used" -> {ok:true}.
 * Flint not running, codes turned off, or any socket failure -> {ok:false, error:{code, message}} with code
 * "not_running" | "disabled" | "auth" | "invalid" | "internal". The host serves requests until stdin closes, so it
 * works for both connectNative and sendNativeMessage (one request, one response, then the browser closes stdin).
 */
export type NativeResponse =
  | { ok: true; codes?: WireCode[]; running?: boolean }
  | { ok: false; error: { code: "not_running" | "disabled" | "auth" | "invalid" | "internal"; message: string } };

// ---------- Host manifests ----------

export type HostManifest =
  | { name: string; description: string; path: string; type: "stdio"; allowed_origins: string[] }
  | { name: string; description: string; path: string; type: "stdio"; allowed_extensions: string[] };

export const HOST_DESCRIPTION = "Flint verification codes";

export function hostManifest(family: "chromium" | "firefox", wrapperPath: string): HostManifest {
  return family === "firefox"
    ? { name: CODES_HOST_NAME, description: HOST_DESCRIPTION, path: wrapperPath, type: "stdio", allowed_extensions: [CODES_FIREFOX_ID] }
    : { name: CODES_HOST_NAME, description: HOST_DESCRIPTION, path: wrapperPath, type: "stdio", allowed_origins: [CODES_ALLOWED_ORIGIN] };
}

/** A manifest is Flint's when its description is HOST_DESCRIPTION and its path ends in CODES_HOST_WRAPPER_FILE. Anything else is foreign: never overwritten or removed. */
export function isFlintManifest(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const m = value as { name?: unknown; description?: unknown; path?: unknown };
  return m.name === CODES_HOST_NAME && m.description === HOST_DESCRIPTION && typeof m.path === "string" && m.path.endsWith(`/${CODES_HOST_WRAPPER_FILE}`);
}

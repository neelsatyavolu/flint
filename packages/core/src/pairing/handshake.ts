// The Mac's half of the handshake: read the phone's plaintext HELLO and derive the session.

import { timingSafeEqual } from "node:crypto";
import { deriveSession, fromBase64Url, KEY_LENGTH, PROTOCOL_VERSION, sharedSecret, SID_LENGTH, type Keypair, type SessionKeys } from "./crypto";

export const MAX_DEVICE_NAME = 64;

export type Hello = { phonePublic: Buffer; deviceName: string };

/** Validates a HELLO body against the session id. Null for anything malformed or for another session. */
export function parseHello(body: Buffer, sid: Buffer): Hello | null {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const theirSid = fromBase64Url(v?.sid);
  const pk = fromBase64Url(v?.pk);
  const name = typeof v?.name === "string" ? cleanDeviceName(v.name) : "";
  if (v?.v !== PROTOCOL_VERSION || !name) return null;
  if (theirSid?.length !== SID_LENGTH || !timingSafeEqual(theirSid, sid)) return null;
  if (pk?.length !== KEY_LENGTH) return null;
  return { phonePublic: pk, deviceName: name };
}

/** Control characters out, whitespace collapsed, length capped. The name is shown in a dialog and stored. */
export function cleanDeviceName(raw: string): string {
  const printable = Array.from(raw, (ch) => {
    const code = ch.codePointAt(0)!;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || (code >= 0x200e && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) ? " " : ch;
  }).join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, MAX_DEVICE_NAME);
}

/** Null when the phone sent a weak key. */
export function deriveFor(mac: Keypair, hello: Hello, sid: Buffer): SessionKeys | null {
  try {
    return deriveSession(sharedSecret(mac.privateKey, hello.phonePublic), sid, mac.publicKey, hello.phonePublic);
  } catch {
    return null;
  }
}

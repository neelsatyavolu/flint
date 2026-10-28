// The pairing QR: `flint://pair#<base64url(JSON)>` carrying { v, sid, pk, addrs, port }. The QR is the authenticated
// channel: it pins the Mac's public key. Rendering uses the `qrcode` package.

import QRCode from "qrcode";
import { fromBase64Url, KEY_LENGTH, PROTOCOL_VERSION, SID_LENGTH, toBase64Url } from "./crypto";

export const PAIR_URL_PREFIX = "flint://pair#";
export const MAX_ADDRS = 3;

export type PairingOffer = { sid: Buffer; pk: Buffer; addrs: string[]; port: number };

export function encodeOffer(offer: PairingOffer): string {
  const json = JSON.stringify({ v: PROTOCOL_VERSION, sid: toBase64Url(offer.sid), pk: toBase64Url(offer.pk), addrs: offer.addrs.slice(0, MAX_ADDRS), port: offer.port });
  return PAIR_URL_PREFIX + toBase64Url(Buffer.from(json));
}

/** Reads an offer back. Returns null for anything that is not a well-formed v1 offer. */
export function decodeOffer(url: string): PairingOffer | null {
  if (!url.startsWith(PAIR_URL_PREFIX)) return null;
  const raw = fromBase64Url(url.slice(PAIR_URL_PREFIX.length));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const sid = fromBase64Url(v.sid);
    const pk = fromBase64Url(v.pk);
    const addrs = v.addrs;
    const port = v.port;
    if (v.v !== PROTOCOL_VERSION || sid?.length !== SID_LENGTH || pk?.length !== KEY_LENGTH) return null;
    if (!Array.isArray(addrs) || addrs.length === 0 || addrs.length > MAX_ADDRS || !addrs.every((a) => typeof a === "string" && a.length <= 45)) return null;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { sid, pk, addrs: addrs as string[], port };
  } catch {
    return null;
  }
}

/** SVG markup of the QR, dark modules on a transparent background so the page theme shows through `currentColor`. */
export function renderQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#0000" } });
}

// Key agreement, key derivation and frame sealing for "Set up from your Mac" (docs/ios/DESIGN-NOTES.md section 7).
// Node's own crypto only: X25519, HKDF-SHA256, ChaCha20-Poly1305. The Swift side (FlintPairing) reproduces
// every value in packages/core/fixtures/pairing-vectors.json.

import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

export const PROTOCOL_VERSION = 1;
export const KEY_LENGTH = 32;
export const SID_LENGTH = 16;
export const TAG_LENGTH = 16;

/** Which way a sealed frame travels. The byte is part of the associated data, so a frame cannot be reflected. */
export const Direction = { macToPhone: 0x01, phoneToMac: 0x02 } as const;
export type DirectionByte = (typeof Direction)[keyof typeof Direction];

const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const INFO_KEYS = Buffer.from("flint-pair/v1");
const INFO_SAS = Buffer.from("flint-pair/sas");

export type Keypair = { privateKey: Buffer; publicKey: Buffer };
export type SessionKeys = { macToPhone: Buffer; phoneToMac: Buffer; sas: string };

export class PairingCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingCryptoError";
  }
}

const privateObject = (raw: Buffer) => createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });

export function publicFromPrivate(privateKey: Buffer): Buffer {
  const der = createPublicKey(privateObject(privateKey)).export({ format: "der", type: "spki" });
  return Buffer.from(der.subarray(der.length - KEY_LENGTH));
}

export function generateKeypair(): Keypair {
  const { privateKey } = generateKeyPairSync("x25519");
  const der = privateKey.export({ format: "der", type: "pkcs8" });
  const raw = Buffer.from(der.subarray(der.length - KEY_LENGTH));
  return { privateKey: raw, publicKey: publicFromPrivate(raw) };
}

export const newSessionId = (): Buffer => randomBytes(SID_LENGTH);

/** X25519 shared secret. Throws on a wrong-sized key or a low-order point (all-zero output). */
export function sharedSecret(privateKey: Buffer, peerPublic: Buffer): Buffer {
  if (privateKey.length !== KEY_LENGTH || peerPublic.length !== KEY_LENGTH) throw new PairingCryptoError("Keys must be 32 bytes.");
  const peer = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, peerPublic]), format: "der", type: "spki" });
  let secret: Buffer;
  try {
    secret = diffieHellman({ privateKey: privateObject(privateKey), publicKey: peer });
  } catch {
    throw new PairingCryptoError("Rejected a weak public key.");
  }
  if (secret.every((b) => b === 0)) throw new PairingCryptoError("Rejected a weak public key.");
  return Buffer.from(secret);
}

const hkdf = (ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer => Buffer.from(hkdfSync("sha256", ikm, salt, info, length));

/** Both directions' keys and the six-digit code, from the shared secret. `a` is the Mac's public key, `b` the phone's. */
export function deriveSession(shared: Buffer, sid: Buffer, a: Buffer, b: Buffer): SessionKeys {
  const material = hkdf(shared, sid, Buffer.concat([INFO_KEYS, a, b]), 64);
  const sasBytes = hkdf(shared, sid, INFO_SAS, 4);
  const sas = String(sasBytes.readUInt32BE(0) % 1_000_000).padStart(6, "0");
  return { macToPhone: material.subarray(0, 32), phoneToMac: material.subarray(32, 64), sas };
}

/** "482913" shown as "482 913". */
export const formatSas = (sas: string): string => `${sas.slice(0, 3)} ${sas.slice(3)}`;

/** 4 zero bytes, then the counter as a 64-bit big-endian integer. */
export function nonceFor(counter: bigint): Buffer {
  if (counter < 0n || counter > 0xffffffffffffffffn) throw new PairingCryptoError("Counter out of range.");
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(counter, 4);
  return nonce;
}

const aadFor = (sid: Buffer, direction: DirectionByte, type: number): Buffer => Buffer.concat([sid, Buffer.from([direction, type])]);

/** Ciphertext followed by the 16-byte tag. */
export function seal(key: Buffer, sid: Buffer, direction: DirectionByte, type: number, counter: bigint, plaintext: Buffer): Buffer {
  const cipher = createCipheriv("chacha20-poly1305", key, nonceFor(counter), { authTagLength: TAG_LENGTH });
  cipher.setAAD(aadFor(sid, direction, type), { plaintextLength: plaintext.length });
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]);
}

/** Throws PairingCryptoError when the tag does not verify (tampering, wrong key, wrong counter, wrong direction or type). */
export function open(key: Buffer, sid: Buffer, direction: DirectionByte, type: number, counter: bigint, sealed: Buffer): Buffer {
  if (sealed.length < TAG_LENGTH) throw new PairingCryptoError("Frame too short.");
  const decipher = createDecipheriv("chacha20-poly1305", key, nonceFor(counter), { authTagLength: TAG_LENGTH });
  decipher.setAAD(aadFor(sid, direction, type), { plaintextLength: sealed.length - TAG_LENGTH });
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_LENGTH));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_LENGTH)), decipher.final()]);
  } catch {
    throw new PairingCryptoError("Frame did not verify.");
  }
}

export const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** Decodes unpadded base64url strictly; null for anything else. */
export function fromBase64Url(text: unknown): Buffer | null {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  return Buffer.from(text, "base64url");
}

// Wire framing: 4-byte big-endian length, 1 type byte, body. The length counts the type byte and the body.
// A frame is at most MAX_FRAME bytes after the length field; anything bigger closes the connection.

export const MAX_FRAME = 64 * 1024;

export const FrameType = {
  hello: 0x01,
  ready: 0x02,
  /** One chunk of the bundle. Sealed plaintext: a flag byte (0 more, 1 last) then up to CHUNK_SIZE bytes of JSON. */
  bundle: 0x03,
  ack: 0x04,
} as const;
export type FrameTypeByte = (typeof FrameType)[keyof typeof FrameType];

export const CHUNK_SIZE = 32 * 1024;
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

export type Frame = { type: number; body: Buffer };

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameError";
  }
}

export function encodeFrame(type: number, body: Buffer): Buffer {
  const length = 1 + body.length;
  if (length > MAX_FRAME) throw new FrameError("Frame too large.");
  const head = Buffer.alloc(5);
  head.writeUInt32BE(length, 0);
  head[4] = type;
  return Buffer.concat([head, body]);
}

/** Accumulates socket data and yields whole frames. Throws FrameError on a zero or oversize length, before buffering the body. */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: Frame[] = [];
    for (;;) {
      if (this.buffer.length < 4) break;
      const length = this.buffer.readUInt32BE(0);
      if (length < 1 || length > MAX_FRAME) throw new FrameError("Bad frame length.");
      if (this.buffer.length < 4 + length) break;
      frames.push({ type: this.buffer[4]!, body: Buffer.from(this.buffer.subarray(5, 4 + length)) });
      this.buffer = this.buffer.subarray(4 + length);
    }
    return frames;
  }
}

/** Splits JSON bytes into BUNDLE plaintexts: flag byte then data. */
export function chunkBundle(json: Buffer): Buffer[] {
  if (json.length > MAX_BUNDLE_BYTES) throw new FrameError("Bundle too large.");
  const out: Buffer[] = [];
  for (let offset = 0; offset === 0 || offset < json.length; offset += CHUNK_SIZE) {
    const part = json.subarray(offset, offset + CHUNK_SIZE);
    out.push(Buffer.concat([Buffer.from([offset + CHUNK_SIZE >= json.length ? 1 : 0]), part]));
  }
  return out;
}

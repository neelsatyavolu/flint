import { createHmac } from "node:crypto";

/** The shared secret encodes 32 random bytes; sign exactly the bytes sent as the HTTP body. */
export function deliveryHeaders(connectionId: string, secret: string, timestamp: number, body: string): Record<string, string> {
  const signature = createHmac("sha256", Buffer.from(secret, "base64url")).update(`${timestamp}.${body}`).digest("hex");
  return {
    "Content-Type": "application/json",
    "X-Flint-Connection": connectionId,
    "X-Flint-Timestamp": String(timestamp),
    "X-Flint-Signature": `v1=${signature}`,
  };
}

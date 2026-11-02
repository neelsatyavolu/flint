import { expect, it } from "vitest";
import { deliveryHeaders } from "./signer";

it("signs the timestamp and exact body bytes with the decoded 32-byte secret", () => {
  // Expected hex independently computed with Python hmac/hashlib.
  const secret = Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString("base64url");
  expect(deliveryHeaders("connection-id", secret, 1730000000, '{"messageId":"abc@example.test","subject":"Your reservation"}')).toEqual({
    "Content-Type": "application/json",
    "X-Flint-Connection": "connection-id",
    "X-Flint-Timestamp": "1730000000",
    "X-Flint-Signature": "v1=de2c753620a09b1c1ec3367ddc5a588e86209ace325a35f549b708c19a8995dc",
  });
});

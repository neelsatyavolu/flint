import { z } from "zod";

const endpointSchema = z.url({ protocol: /^https?$/ });

export type EndpointCheck = { ok: true; value: string } | { ok: false; message: string };

/** The receipts endpoint may be empty (not configured) or an http(s) base URL. Trailing slashes are dropped. */
export function checkEndpoint(raw: string): EndpointCheck {
  const value = raw.trim().replace(/\/+$/, "");
  if (value === "") return { ok: true, value };
  const parsed = endpointSchema.safeParse(value);
  if (!parsed.success) return { ok: false, message: "Enter a full address such as https://receipts.example.com." };
  if (value.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(value)) {
    return { ok: false, message: "Use https. Plain http is only accepted for localhost." };
  }
  return { ok: true, value };
}

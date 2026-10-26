import type { WireCode } from "./protocol";

const MAX_CODES = 20;

/** Keeps only well-formed codes from an untrusted reply. */
export function sanitizeCodes(value: unknown): WireCode[] {
  if (!Array.isArray(value)) return [];
  const out: WireCode[] = [];
  for (const raw of value.slice(0, MAX_CODES)) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if (
      typeof c.id !== "string" || c.id.length === 0 || c.id.length > 128 ||
      typeof c.code !== "string" || !/^[A-Za-z0-9-]{3,12}$/.test(c.code) ||
      typeof c.service !== "string" || typeof c.senderDomain !== "string" ||
      typeof c.receivedAt !== "number" || !Number.isFinite(c.receivedAt)
    ) continue;
    out.push({ id: c.id, code: c.code, service: c.service.slice(0, 80), senderDomain: c.senderDomain.slice(0, 253), receivedAt: c.receivedAt });
  }
  return out;
}

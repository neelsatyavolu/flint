import type { Env } from "./env";
import { constantTimeEqual, sha256Hex } from "./fingerprint";
import { HttpError } from "./http";

const DUMMY_HASH = "0".repeat(64);

/** Parses `Authorization: Bearer <installId>.<secret>` and verifies sha256(secret) in constant time. Returns the install id. */
export async function authenticate(request: Request, env: Env): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const m = /^Bearer ([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{16,128})$/.exec(header);
  if (!m) throw new HttpError("unauthorized", "Missing or malformed credentials.");
  const [, installId, secret] = m as unknown as [string, string, string];
  const row = await env.DB.prepare("SELECT secret_hash FROM installs WHERE id = ?").bind(installId).first<{ secret_hash: string }>();
  const provided = await sha256Hex(secret);
  // Always compare, even for unknown installs, so timing does not reveal which ids exist.
  const ok = constantTimeEqual(provided, row?.secret_hash ?? DUMMY_HASH);
  if (!row || !ok) throw new HttpError("unauthorized", "Credentials not recognized.");
  return installId;
}

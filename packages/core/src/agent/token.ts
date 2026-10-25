import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Reads the bearer token, creating it (32 random bytes, hex, mode 600) when missing or too short. */
export function ensureToken(tokenPath: string): string {
  mkdirSync(dirname(tokenPath), { recursive: true });
  if (existsSync(tokenPath)) {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (existing.length >= 32) {
      chmodSync(tokenPath, 0o600);
      return existing;
    }
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, token, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  return token;
}

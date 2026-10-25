const DROP_KEYS = new Set(["html", "text", "body", "quotedHtml", "password", "secret", "token", "clientSecret"]);
const MAX_STRING = 200;
const MAX_DEPTH = 4;

/** Copy of call params that is safe to store in Agent Activity: no bodies, no secrets, bounded size. */
export function redactParams(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "…";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactParams(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (DROP_KEYS.has(k)) continue;
    out[k] = redactParams(v, depth + 1);
  }
  return out;
}

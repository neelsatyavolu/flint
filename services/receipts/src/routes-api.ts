import { authenticate } from "./auth";
import { parseJsonBody } from "./body";
import { INSTALL_LIMIT_PER_HOUR, MAX_TOKENS_PER_INSTALL, REGISTER_LIMIT_PER_HOUR, SEEN_LIMIT_PER_HOUR, type Env } from "./env";
import { fingerprintIp, installFingerprint, sha256Hex } from "./fingerprint";
import { HttpError, json } from "./http";
import { EventsQuerySchema, RegisterMessageRequestSchema, type EventsResponse, type InstallResponse } from "./protocol";
import { requestIp } from "./request";

function randomB64Url(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hitRateLimit(env: Env, key: string, limit: number, now: number): Promise<void> {
  const windowStart = now - (now % 3_600_000);
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count",
  ).bind(key, windowStart).first<{ count: number }>();
  if ((row?.count ?? 1) > limit) throw new HttpError("rate_limited", "Too many requests. Try again later.");
}

export async function handleInstall(request: Request, env: Env, now: number): Promise<Response> {
  const fp = await fingerprintIp(env.FINGERPRINT_SALT, requestIp(request));
  const windowStart = now - (now % 3_600_000);
  const key = `install:${fp}`;
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count",
  ).bind(key, windowStart).first<{ count: number }>();
  if ((row?.count ?? 1) > INSTALL_LIMIT_PER_HOUR) throw new HttpError("rate_limited", "Too many installs from this network. Try again in an hour.");
  const installId = randomB64Url(12);
  const secret = randomB64Url(32);
  await env.DB.prepare("INSERT INTO installs (id, secret_hash, created_at) VALUES (?, ?, ?)").bind(installId, await sha256Hex(secret), now).run();
  const body: InstallResponse = { installId, secret };
  return json(body, 201);
}

async function recordSender(env: Env, installId: string, fingerprint: string, now: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO sender_fingerprints (install_id, fingerprint, seen_at) VALUES (?, ?, ?) ON CONFLICT(install_id, fingerprint) DO UPDATE SET seen_at = excluded.seen_at",
  ).bind(installId, fingerprint, now).run();
}

export async function handleRegister(request: Request, env: Env, now: number): Promise<Response> {
  const installId = await authenticate(request, env);
  await hitRateLimit(env, `register:${installId}`, REGISTER_LIMIT_PER_HOUR, now);
  const body = await parseJsonBody(request, RegisterMessageRequestSchema);
  const tokens = body.recipients.map((r) => r.token);
  if (new Set(tokens).size !== tokens.length) throw new HttpError("bad_request", "Duplicate tokens in request.");
  const placeholders = tokens.map(() => "?").join(",");
  const taken = await env.DB.prepare(`SELECT token, install_id, ref FROM tokens WHERE token IN (${placeholders})`)
    .bind(...tokens).all<{ token: string; install_id: string; ref: string }>();
  if (taken.results.some((t) => t.install_id !== installId || t.ref !== body.ref)) throw new HttpError("conflict", "A token is already in use.");
  const known = new Set(taken.results.map((t) => t.token));
  const fresh = tokens.filter((t) => !known.has(t)).length;
  if (fresh > 0) {
    const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM tokens WHERE install_id = ?").bind(installId).first<{ n: number }>();
    if ((live?.n ?? 0) + fresh > MAX_TOKENS_PER_INSTALL) throw new HttpError("rate_limited", "Too many live tokens for this install.");
  }
  const existing = await env.DB.prepare("SELECT registered_at FROM messages WHERE install_id = ? AND ref = ?").bind(installId, body.ref).first<{ registered_at: number }>();
  const registeredAt = existing?.registered_at ?? now;
  const stmts = [
    env.DB.prepare("INSERT OR IGNORE INTO messages (install_id, ref, registered_at) VALUES (?, ?, ?)").bind(installId, body.ref, registeredAt),
    ...tokens.filter((t) => !known.has(t)).map((t) =>
      env.DB.prepare("INSERT INTO tokens (token, install_id, ref, registered_at) VALUES (?, ?, ?, ?)").bind(t, installId, body.ref, registeredAt)),
  ];
  await env.DB.batch(stmts);
  await recordSender(env, installId, await fingerprintIp(env.FINGERPRINT_SALT, requestIp(request)), now);
  return json({ ref: body.ref, recipients: tokens.length }, 201);
}

export async function handleDeleteMessage(request: Request, env: Env, ref: string): Promise<Response> {
  const installId = await authenticate(request, env);
  let decoded: string;
  try {
    decoded = decodeURIComponent(ref);
  } catch {
    throw new HttpError("bad_request", "Malformed message ref.");
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events WHERE token IN (SELECT token FROM tokens WHERE install_id = ? AND ref = ?)").bind(installId, decoded),
    env.DB.prepare("DELETE FROM tokens WHERE install_id = ? AND ref = ?").bind(installId, decoded),
    env.DB.prepare("DELETE FROM messages WHERE install_id = ? AND ref = ?").bind(installId, decoded),
  ]);
  return json({ ok: true });
}

export async function handleSeen(request: Request, env: Env, now: number): Promise<Response> {
  const installId = await authenticate(request, env);
  await hitRateLimit(env, `seen:${installId}`, SEEN_LIMIT_PER_HOUR, now);
  await recordSender(env, installId, await fingerprintIp(env.FINGERPRINT_SALT, requestIp(request)), now);
  return json({ ok: true });
}

type EventRow = {
  id: number; token: string; at: number; kind: EventsResponse["events"][number]["kind"];
  client: string | null; device: string | null; country: string | null; city: string | null;
  fingerprint: string; possibly_forwarded: number;
};

export async function handleEvents(request: Request, env: Env): Promise<Response> {
  const installId = await authenticate(request, env);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = EventsQuerySchema.safeParse(params);
  if (!parsed.success) throw new HttpError("bad_request", "Invalid query: after must be a non-negative integer and limit between 1 and 500.");
  const { after, limit } = parsed.data;
  const rows = await env.DB.prepare(
    "SELECT id, token, at, kind, client, device, country, city, fingerprint, possibly_forwarded FROM events WHERE install_id = ? AND id > ? ORDER BY id LIMIT ?",
  ).bind(installId, after, limit).all<EventRow>();
  const events = await Promise.all(rows.results.map(async (r) => ({
    id: r.id, token: r.token, at: r.at, kind: r.kind, client: r.client, device: r.device, country: r.country, city: r.city,
    fingerprint: await installFingerprint(env.FINGERPRINT_SALT, installId, r.fingerprint),
    possiblyForwarded: r.possibly_forwarded === 1,
  })));
  const last = events[events.length - 1];
  const body: EventsResponse = { events, cursor: String(last ? last.id : after) };
  return json(body);
}

import { classify } from "./classify";
import { isApplePrivateRelayIp } from "./apple";
import { loadAppleRanges } from "./apple-refresh";
import { MAX_EVENTS_PER_TOKEN, SENDER_FINGERPRINT_TTL_MS, type Env } from "./env";
import { fingerprintIp } from "./fingerprint";
import { TOKEN_RE } from "./protocol";
import { cfProps, requestIp } from "./request";

export function tokenFromPath(path: string): string | null {
  const m = /^\/i\/([^/]+?)(?:\.gif)?$/.exec(path);
  return m?.[1] && TOKEN_RE.test(m[1]) ? m[1] : null;
}

/** Records a pixel hit. Never throws to the caller: failures are logged and dropped. */
export async function recordHit(request: Request, env: Env, token: string, now: number): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT install_id, registered_at FROM tokens WHERE token = ?")
      .bind(token).first<{ install_id: string; registered_at: number }>();
    if (!row) return;
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE token = ?").bind(token).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_EVENTS_PER_TOKEN) return;

    const ip = requestIp(request);
    const cf = cfProps(request);
    const fingerprint = await fingerprintIp(env.FINGERPRINT_SALT, ip);
    const [senders, opens, ranges] = await Promise.all([
      env.DB.prepare("SELECT fingerprint FROM sender_fingerprints WHERE install_id = ? AND seen_at > ?")
        .bind(row.install_id, now - SENDER_FINGERPRINT_TTL_MS).all<{ fingerprint: string }>(),
      env.DB.prepare("SELECT at, fingerprint, client FROM events WHERE token = ? AND kind = 'open' ORDER BY at LIMIT 50")
        .bind(token).all<{ at: number; fingerprint: string; client: string | null }>(),
      loadAppleRanges(env, now),
    ]);
    const c = classify(
      {
        method: request.method, userAgent: request.headers.get("User-Agent") ?? "", asn: cf.asn ?? null,
        asOrganization: cf.asOrganization ?? null, country: cf.country ?? null, city: cf.city ?? null,
        fingerprint, appleEgress: isApplePrivateRelayIp(ip, ranges),
      },
      {
        secondsSinceRegistered: (now - row.registered_at) / 1000,
        senderFingerprints: senders.results.map((s) => s.fingerprint),
        previousOpens: opens.results,
        now,
      },
    );
    await env.DB.prepare(
      "INSERT INTO events (token, install_id, at, kind, client, device, country, city, fingerprint, possibly_forwarded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      token, row.install_id, now, c.kind, c.client, c.device,
      c.locationReliable ? (cf.country ?? null) : null, c.locationReliable ? (cf.city ?? null) : null,
      fingerprint, c.possiblyForwarded ? 1 : 0,
    ).run();
  } catch (err) {
    console.error("receipts: failed to record hit", err instanceof Error ? err.message : String(err));
  }
}

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { FlintError } from "../types";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
/** Scopes for a new Google sign-in: mail, who you are, and calendar events (to answer invitations). */
export const GOOGLE_SCOPES = `https://mail.google.com/ openid email profile ${GOOGLE_CALENDAR_SCOPE}`;
/** The scopes an account that signed in before calendar support has. */
export const GOOGLE_BASE_SCOPES = "https://mail.google.com/ openid email profile";
/** True when a granted-scope string (the token response's `scope`) includes the Calendar events scope. */
export const hasCalendarScope = (scope: string | undefined | null): boolean => (scope ?? "").split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE);
/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type GoogleTokens = { accessToken: string; refreshToken: string; expiresAt: number };
export type GoogleSignIn = GoogleTokens & {
  email: string; name: string; /** Profile picture URL from the ID token, when Google sent one. */ picture?: string;
  /** Space-separated scopes Google actually granted (the user can untick some). Check with hasCalendarScope. */
  scope?: string;
};

export type GoogleAuthOptions = {
  clientId: string;
  clientSecret: string;
  openExternal: (url: string) => Promise<void>;
  fetch?: FetchLike;
  /** 0 = ephemeral. Tests pass a fixed port. */
  port?: number;
  timeoutMs?: number;
  now?: () => number;
  /** Scopes to ask for. Default GOOGLE_SCOPES. */
  scopes?: string;
  /** Incremental consent for an existing account: pre-selects it (login_hint) and adds to what it already granted (include_granted_scopes=true). */
  incremental?: { loginHint: string };
};

const tokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().default(3600),
  id_token: z.string().optional(),
  scope: z.string().optional(),
});
const errorResponse = z.object({ error: z.string().optional(), error_description: z.string().optional() });

const defaultFetch: FetchLike = (url, init) => fetch(url, init);
const b64url = (buf: Buffer): string => buf.toString("base64url");

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function buildAuthUrl(p: { clientId: string; redirectUri: string; challenge: string; state: string; scopes?: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId, redirect_uri: p.redirectUri, response_type: "code", scope: p.scopes ?? GOOGLE_SCOPES,
    code_challenge: p.challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent", state: p.state,
  });
  if (p.loginHint) {
    q.set("login_hint", p.loginHint);
    q.set("include_granted_scopes", "true");
  }
  return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

/** Reads email, name and picture URL from the ID token payload. The token came straight from Google's token endpoint over TLS. */
export function parseIdToken(idToken: string): { email: string; name: string; picture?: string } {
  const payload = idToken.split(".")[1];
  if (!payload) throw new FlintError("auth", "Google did not return account details. Try signing in again.");
  try {
    const claims = z.object({ email: z.string(), name: z.string().optional(), picture: z.string().optional() }).parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return { email: claims.email.toLowerCase(), name: claims.name ?? "", ...(claims.picture ? { picture: claims.picture } : {}) };
  } catch {
    throw new FlintError("auth", "Google did not return account details. Try signing in again.");
  }
}

async function postToken(f: FetchLike, params: Record<string, string>): Promise<z.infer<typeof tokenResponse>> {
  let res;
  try {
    res = await f(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    throw new FlintError("network", "Could not reach Google. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = errorResponse.safeParse(data);
    const code = err.success ? err.data.error : undefined;
    if (res.status >= 500 || res.status === 429) throw new FlintError("network", "Google is temporarily unavailable. Flint will try again.");
    if (code === "invalid_grant") throw new FlintError("auth", "Google sign-in expired. Sign in again.");
    throw new FlintError("auth", `Google rejected the sign-in${code ? ` (${code})` : ""}.`);
  }
  return tokenResponse.parse(data);
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const PAGE = (msg: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Flint</title><body style="font:16px system-ui;margin:4rem auto;max-width:28rem;color:#222"><p>${escapeHtml(msg)}</p></body>`;

function waitForCode(server: Server, state: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new FlintError("auth", "Google sign-in timed out. Try again.")), timeoutMs);
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      // A request without our state is not Google's redirect (a stray page or a port scan): answer it and keep waiting.
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "content-type": "text/html" }).end(PAGE("This request could not be verified."));
        return;
      }
      const fail = (message: string) => {
        res.writeHead(400, { "content-type": "text/html" }).end(PAGE(message));
        clearTimeout(timer);
        reject(new FlintError("auth", message));
      };
      if (error) return fail(error === "access_denied" ? "Google sign-in was cancelled." : "Google sign-in failed.");
      if (!code) return fail("Google sign-in could not be verified. Try again.");
      res.writeHead(200, { "content-type": "text/html" }).end(PAGE("Signed in. You can close this tab and return to Flint."));
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** Loopback PKCE flow. Resolves with tokens plus the account's email and name. */
export async function startGoogleAuth(opts: GoogleAuthOptions): Promise<GoogleSignIn> {
  if (!opts.clientId || !opts.clientSecret) throw new FlintError("invalid", "Add a Google client ID and secret in Settings first.");
  const f = opts.fetch ?? defaultFetch;
  const now = opts.now ?? Date.now;
  const { verifier, challenge } = createPkce();
  const state = b64url(randomBytes(16));
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", resolve);
  });
  try {
    const port = (server.address() as AddressInfo).port;
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
    const codePromise = waitForCode(server, state, opts.timeoutMs ?? 5 * 60 * 1000);
    codePromise.catch(() => undefined);
    await opts.openExternal(buildAuthUrl({
      clientId: opts.clientId, redirectUri, challenge, state,
      ...(opts.scopes ? { scopes: opts.scopes } : {}), ...(opts.incremental ? { loginHint: opts.incremental.loginHint } : {}),
    }));
    const code = await codePromise;
    const t = await postToken(f, {
      code, client_id: opts.clientId, client_secret: opts.clientSecret, redirect_uri: redirectUri,
      grant_type: "authorization_code", code_verifier: verifier,
    });
    if (!t.refresh_token) throw new FlintError("auth", "Google did not return a refresh token. Remove Flint from your Google account permissions and try again.");
    if (!t.id_token) throw new FlintError("auth", "Google did not return account details. Try signing in again.");
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: now() + t.expires_in * 1000, ...parseIdToken(t.id_token), ...(t.scope ? { scope: t.scope } : {}) };
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

export type RefreshOptions = { clientId: string; clientSecret: string; refreshToken: string; fetch?: FetchLike; now?: () => number };

/** Exchanges a refresh token for a new access token. Google may rotate the refresh token; the new one is returned when it does. */
export async function refreshGoogleToken(opts: RefreshOptions): Promise<GoogleTokens> {
  const t = await postToken(opts.fetch ?? defaultFetch, {
    client_id: opts.clientId, client_secret: opts.clientSecret, refresh_token: opts.refreshToken, grant_type: "refresh_token",
  });
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? opts.refreshToken, expiresAt: (opts.now ?? Date.now)() + t.expires_in * 1000 };
}

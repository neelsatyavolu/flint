import {
  authorizeUrl, exchangeCode, generatePkce, parseCallback, refreshTokens, type PKCE, type Provider, type Tokens,
} from "@neelsatyavolu/shared-ai-auth";
import { z } from "zod";
import { logger } from "../log";
import { FlintError } from "../types";
import { startLoopback, type LoopbackHandle, type LoopbackStarter } from "./loopback";
import type { AiContext } from "./ports";

const log = logger("ai-auth");

export const TOKENS_KEY = "ai:tokens";
export const PENDING_TTL_MS = 10 * 60_000;
export const CODEX_CALLBACK_PORT = 1455;
export const CODEX_CALLBACK_PATH = "/auth/callback";
const REFRESH_AHEAD_MS = 30_000;
const NOT_CONNECTED = "Connect ChatGPT or Grok in Settings → +AI";

const storedSchema = z.object({
  provider: z.enum(["codex", "grok"]),
  tokens: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number(),
    idToken: z.string().optional(),
    accountId: z.string().optional(),
  }),
});
export type StoredAuth = { provider: Provider; tokens: Tokens };

export type AuthOptions = {
  /** null disables the Codex loopback listener (tests, or when only pasting). */
  loopback?: LoopbackStarter | null;
  port?: number;
  pendingTtlMs?: number;
  onChange?: () => void;
};

type Pending = { pkce: PKCE; expiresAt: number };

export function createAuth(ctx: AiContext, options: AuthOptions = {}) {
  const starter = options.loopback === undefined ? startLoopback : options.loopback;
  const ttl = options.pendingTtlMs ?? PENDING_TTL_MS;
  const pending = new Map<Provider, Pending>();
  let listener: LoopbackHandle | null = null;
  let refreshing: { refreshToken: string; promise: Promise<StoredAuth> } | null = null;

  const fetchOpt = () => (ctx.fetch ? { fetch: ctx.fetch } : {});

  async function stored(): Promise<StoredAuth | null> {
    const raw = await ctx.secrets.get(TOKENS_KEY);
    if (!raw) return null;
    try {
      const parsed = storedSchema.parse(JSON.parse(raw));
      return { provider: parsed.provider, tokens: parsed.tokens };
    } catch {
      log.warn("stored AI tokens were unreadable and were ignored");
      return null;
    }
  }

  async function save(auth: StoredAuth): Promise<void> {
    await ctx.secrets.set(TOKENS_KEY, JSON.stringify(auth));
  }

  function liveAttempt(provider: Provider): Pending | null {
    const p = pending.get(provider);
    if (!p) return null;
    if (p.expiresAt <= ctx.now()) {
      pending.delete(provider);
      return null;
    }
    return p;
  }

  function stopListener(): void {
    const l = listener;
    listener = null;
    l?.close();
  }

  /** `fromListener`: the loopback server closes itself once it has answered the browser. */
  async function complete(provider: Provider, code: string, verifier: string, fromListener = false): Promise<StoredAuth> {
    let tokens: Tokens;
    try {
      tokens = await exchangeCode(provider, code, verifier, fetchOpt());
    } catch (err) {
      log.warn("code exchange failed", { provider, error: err instanceof Error ? err.message : String(err) });
      throw new FlintError("auth", "Couldn't finish signing in. Start again from Settings → +AI.");
    }
    const auth = { provider, tokens };
    await save(auth);
    pending.delete(provider);
    if (!fromListener) stopListener();
    options.onChange?.();
    return auth;
  }

  async function startConnect(provider: Provider): Promise<{ url: string; needsPaste: boolean }> {
    const pkce = generatePkce();
    pending.set(provider, { pkce, expiresAt: ctx.now() + ttl });
    stopListener();
    let listening = false;
    if (provider === "codex" && starter) {
      const handle = await starter({
        port: options.port ?? CODEX_CALLBACK_PORT,
        path: CODEX_CALLBACK_PATH,
        ttlMs: ttl,
        handle: async (url) => {
          const attempt = liveAttempt("codex");
          const cb = parseCallback(url.search);
          if (!attempt || cb.state !== attempt.pkce.state) return { ok: false, ignore: true };
          if (cb.error || !cb.code) return { ok: false };
          try {
            await complete("codex", cb.code, attempt.pkce.verifier, true);
            return { ok: true };
          } catch {
            return { ok: false };
          }
        },
        onClose: () => { listener = null; },
      });
      listener = handle;
      listening = handle !== null;
    }
    return { url: authorizeUrl(provider, pkce), needsPaste: provider === "grok" || !listening };
  }

  async function finishConnect(provider: Provider, pasted: string): Promise<void> {
    const attempt = liveAttempt(provider);
    if (!attempt) throw new FlintError("invalid", "That sign-in expired. Start again from Settings → +AI.");
    const cb = parseCallback(pasted);
    if (cb.error) throw new FlintError("auth", "The sign-in was declined. Start again from Settings → +AI.");
    if (!cb.code) throw new FlintError("invalid", "Paste the full address from the browser or the code it shows.");
    // A bare code carries no state; it binds to the attempt this app started.
    if (cb.state !== null && cb.state !== attempt.pkce.state) {
      throw new FlintError("invalid", "That code belongs to a different sign-in. Start again from Settings → +AI.");
    }
    await complete(provider, cb.code, attempt.pkce.verifier);
  }

  async function refresh(current: StoredAuth): Promise<StoredAuth> {
    // Providers rotate refresh tokens, so concurrent callers share one refresh.
    if (refreshing && refreshing.refreshToken === current.tokens.refreshToken) return refreshing.promise;
    const promise = (async () => {
      try {
        const tokens = await refreshTokens(current.provider, current.tokens.refreshToken, { ...fetchOpt(), previous: current.tokens });
        const next = { provider: current.provider, tokens };
        await save(next);
        return next;
      } catch (err) {
        log.warn("token refresh failed", { provider: current.provider, error: err instanceof Error ? err.message : String(err) });
        throw new FlintError("auth", "Your AI connection expired. Reconnect it in Settings → +AI.");
      }
    })();
    refreshing = { refreshToken: current.tokens.refreshToken, promise };
    try {
      return await promise;
    } finally {
      if (refreshing?.promise === promise) refreshing = null;
    }
  }

  /** Valid credentials, refreshed first when they expire within 30 seconds. */
  async function active(): Promise<StoredAuth> {
    const current = await stored();
    if (!current) throw new FlintError("ai_not_connected", NOT_CONNECTED);
    if (current.tokens.expiresAt > ctx.now() + REFRESH_AHEAD_MS) return current;
    return refresh(current);
  }

  async function forceRefresh(): Promise<StoredAuth> {
    const current = await stored();
    if (!current) throw new FlintError("ai_not_connected", NOT_CONNECTED);
    return refresh(current);
  }

  async function disconnect(): Promise<void> {
    pending.clear();
    stopListener();
    await ctx.secrets.delete(TOKENS_KEY);
    options.onChange?.();
  }

  return {
    stored, startConnect, finishConnect, active, forceRefresh, disconnect,
    dispose: () => { pending.clear(); stopListener(); },
    listenerPort: () => listener?.port ?? null,
  };
}
export type Auth = ReturnType<typeof createAuth>;

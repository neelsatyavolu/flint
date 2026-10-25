import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth, TOKENS_KEY, type Auth } from "./auth";
import { startLoopback } from "./loopback";
import { fakeFetch, makeContext, tokenResponse } from "./testing";

const live: Auth[] = [];
afterEach(() => { live.splice(0).forEach((a) => a.dispose()); });

function setup(over: Parameters<typeof makeContext>[0] = {}, options: Parameters<typeof createAuth>[1] = { loopback: null }) {
  const ctx = makeContext(over);
  const auth = createAuth(ctx, options);
  live.push(auth);
  return { ctx, auth };
}
const stateOf = (url: string) => new URL(url).searchParams.get("state")!;

describe("connect flow", () => {
  it("builds a Grok URL that needs a pasted code, and a bare code binds to the attempt", async () => {
    const f = fakeFetch({});
    const { ctx, auth } = setup({ fetch: f });
    const { url, needsPaste } = await auth.startConnect("grok");
    expect(url).toContain("auth.x.ai");
    expect(needsPaste).toBe(true);
    await auth.finishConnect("grok", "  the-code ");
    const saved = JSON.parse((await ctx.secrets.get(TOKENS_KEY))!);
    expect(saved.provider).toBe("grok");
    expect(saved.tokens.accessToken).toBe("access-1");
    const body = f.calls[0]!.init.body as string;
    expect(body).toContain("code=the-code");
    expect(body).toContain("code_verifier=");
  });

  it("accepts a full callback URL for Codex and checks state", async () => {
    const f = fakeFetch({});
    const { ctx, auth } = setup({ fetch: f });
    const { url, needsPaste } = await auth.startConnect("codex");
    expect(needsPaste).toBe(true); // no listener in this setup
    await expect(auth.finishConnect("codex", "http://localhost:1455/auth/callback?code=abc&state=wrong")).rejects.toMatchObject({ code: "invalid" });
    await auth.finishConnect("codex", `http://localhost:1455/auth/callback?code=abc&state=${stateOf(url)}`);
    expect(JSON.parse((await ctx.secrets.get(TOKENS_KEY))!).tokens.accountId).toBe("acct-1");
  });

  it("rejects an error callback, an empty paste and a missing attempt", async () => {
    const { auth } = setup({ fetch: fakeFetch({}) });
    await expect(auth.finishConnect("grok", "x")).rejects.toMatchObject({ code: "invalid" });
    await auth.startConnect("grok");
    await expect(auth.finishConnect("grok", "")).rejects.toMatchObject({ code: "invalid" });
    await expect(auth.finishConnect("grok", "?error=access_denied")).rejects.toMatchObject({ code: "auth" });
  });

  it("expires a pending attempt after 10 minutes", async () => {
    let now = 1_000_000;
    const { auth } = setup({ fetch: fakeFetch({}), now: () => now });
    await auth.startConnect("grok");
    now += 10 * 60_000 + 1;
    await expect(auth.finishConnect("grok", "code")).rejects.toMatchObject({ code: "invalid" });
  });

  it("reports a failed exchange without saving", async () => {
    const f = fakeFetch({ token: () => new Response("", { status: 400 }) });
    const { ctx, auth } = setup({ fetch: f });
    await auth.startConnect("grok");
    await expect(auth.finishConnect("grok", "bad")).rejects.toMatchObject({ code: "auth" });
    expect(await ctx.secrets.get(TOKENS_KEY)).toBeNull();
  });

  it("disconnect clears tokens", async () => {
    const { ctx, auth } = setup({ fetch: fakeFetch({}) });
    await auth.startConnect("grok");
    await auth.finishConnect("grok", "c");
    await auth.disconnect();
    expect(await ctx.secrets.get(TOKENS_KEY)).toBeNull();
    await expect(auth.active()).rejects.toMatchObject({ code: "ai_not_connected" });
  });

  it("ignores corrupt stored tokens", async () => {
    const { ctx, auth } = setup();
    await ctx.secrets.set(TOKENS_KEY, "{nope");
    await expect(auth.active()).rejects.toMatchObject({ code: "ai_not_connected" });
  });
});

describe("token refresh", () => {
  const stale = (expiresAt: number) => JSON.stringify({
    provider: "codex",
    tokens: { accessToken: "old", refreshToken: "refresh-old", expiresAt, accountId: "acct-keep" },
  });

  it("does not refresh a token that is still valid", async () => {
    const f = fakeFetch({});
    const { ctx, auth } = setup({ fetch: f });
    await ctx.secrets.set(TOKENS_KEY, stale(ctx.now() + 120_000));
    expect((await auth.active()).tokens.accessToken).toBe("old");
    expect(f.calls).toHaveLength(0);
  });

  it("refreshes before expiry, persists, and keeps the previous refresh token and account when omitted", async () => {
    const f = fakeFetch({ token: () => tokenResponse({ access_token: "new", refresh_token: undefined, id_token: undefined }) });
    const { ctx, auth } = setup({ fetch: f });
    await ctx.secrets.set(TOKENS_KEY, stale(ctx.now() + 10_000));
    const got = await auth.active();
    expect(got.tokens.accessToken).toBe("new");
    const saved = JSON.parse((await ctx.secrets.get(TOKENS_KEY))!);
    expect(saved.tokens.accessToken).toBe("new");
    expect(saved.tokens.refreshToken).toBe("refresh-old");
    expect(saved.tokens.accountId).toBe("acct-keep");
    expect(f.calls[0]!.init.body as string).toContain("grant_type=refresh_token");
  });

  it("persists a rotated refresh token", async () => {
    const f = fakeFetch({ token: () => tokenResponse({ refresh_token: "rotated" }) });
    const { ctx, auth } = setup({ fetch: f });
    await ctx.secrets.set(TOKENS_KEY, stale(0));
    await auth.active();
    expect(JSON.parse((await ctx.secrets.get(TOKENS_KEY))!).tokens.refreshToken).toBe("rotated");
  });

  it("shares one refresh between concurrent callers", async () => {
    const f = fakeFetch({ token: async () => { await new Promise((r) => setTimeout(r, 10)); return tokenResponse(); } });
    const { ctx, auth } = setup({ fetch: f });
    await ctx.secrets.set(TOKENS_KEY, stale(0));
    await Promise.all([auth.active(), auth.active(), auth.active()]);
    expect(f.calls.filter((c) => c.url.includes("token"))).toHaveLength(1);
  });

  it("reports a failed refresh as an auth error and keeps the stored tokens", async () => {
    const f = fakeFetch({ token: () => new Response("", { status: 400 }) });
    const { ctx, auth } = setup({ fetch: f });
    await ctx.secrets.set(TOKENS_KEY, stale(0));
    await expect(auth.active()).rejects.toMatchObject({ code: "auth", message: expect.stringContaining("Reconnect") });
    expect(await ctx.secrets.get(TOKENS_KEY)).not.toBeNull();
  });
});

describe("codex loopback listener", () => {
  const get = (port: number, path: string) => fetch(`http://127.0.0.1:${port}${path}`);

  it("completes the sign-in automatically and closes", async () => {
    const f = vi.fn(fakeFetch({}));
    const onChange = vi.fn();
    const { ctx, auth } = setup({ fetch: f as unknown as typeof fetch }, { loopback: startLoopback, port: 0, onChange });
    const { url, needsPaste } = await auth.startConnect("codex");
    expect(needsPaste).toBe(false);
    const port = auth.listenerPort()!;
    expect((await get(port, "/other")).status).toBe(404);
    expect((await get(port, "/auth/callback?code=x&state=wrong")).status).toBe(400);
    expect(auth.listenerPort()).toBe(port); // stray request does not end the attempt
    const res = await get(port, `/auth/callback?code=real&state=${stateOf(url)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Flint is connected. You can close this tab.");
    expect(JSON.parse((await ctx.secrets.get(TOKENS_KEY))!).provider).toBe("codex");
    expect(onChange).toHaveBeenCalled();
    expect(auth.listenerPort()).toBeNull();
    await expect(get(port, "/auth/callback")).rejects.toThrow();
  });

  it("closes after expiry", async () => {
    const { auth } = setup({ fetch: fakeFetch({}) }, { loopback: startLoopback, port: 0, pendingTtlMs: 40 });
    await auth.startConnect("codex");
    const port = auth.listenerPort()!;
    await new Promise((r) => setTimeout(r, 120));
    expect(auth.listenerPort()).toBeNull();
    await expect(get(port, "/auth/callback")).rejects.toThrow();
  });

  it("falls back to paste when the port is taken", async () => {
    const first = setup({ fetch: fakeFetch({}) }, { loopback: startLoopback, port: 0 });
    await first.auth.startConnect("codex");
    const busy = first.auth.listenerPort()!;
    const second = setup({ fetch: fakeFetch({}) }, { loopback: startLoopback, port: busy });
    expect((await second.auth.startConnect("codex")).needsPaste).toBe(true);
  });

  it("an error callback with the right state ends the attempt with a failure page", async () => {
    const { auth } = setup({ fetch: fakeFetch({}) }, { loopback: startLoopback, port: 0 });
    const { url } = await auth.startConnect("codex");
    const res = await get(auth.listenerPort()!, `/auth/callback?error=access_denied&state=${stateOf(url)}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("couldn't connect");
  });

  it("disconnect closes the listener", async () => {
    const { auth } = setup({ fetch: fakeFetch({}) }, { loopback: startLoopback, port: 0 });
    await auth.startConnect("codex");
    await auth.disconnect();
    expect(auth.listenerPort()).toBeNull();
  });
});
